from __future__ import annotations

import json
import logging
import uuid
from typing import Dict, List, Optional

import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import RagDocument

logger = logging.getLogger(__name__)

VECTOR_DIM = 13  # Must match number of features in FEATURE_KEYS
FEATURE_KEYS = [
    "returns_1",
    "returns_5",
    "returns_24",
    "atr_14",
    "rsi_14",
    "macd_hist",
    "vwap",
    "ma_dist_20",
    "ma_dist_50",
    "volatility_20",
    "volume_zscore",
    "funding_delta",
    "oi_delta",
]


def embed_state(features: Dict[str, float]) -> np.ndarray:
    """Convert a feature dict into a normalised float32 unit vector."""
    vec = np.array(
        [float(features.get(k, 0.0) or 0.0) for k in FEATURE_KEYS],
        dtype=np.float32,
    )
    # Replace any NaN/inf that slipped through
    vec = np.nan_to_num(vec, nan=0.0, posinf=0.0, neginf=0.0)
    norm = np.linalg.norm(vec)
    if norm > 1e-9:
        vec = vec / norm
    return vec


class RagStore:
    def __init__(self) -> None:
        self._client: Optional[QdrantClient] = None

    def _get_client(self) -> QdrantClient:
        if self._client is None:
            self._client = QdrantClient(url=settings.qdrant_url)
        return self._client

    async def ensure_collection(self) -> None:
        client = self._get_client()
        existing = client.get_collections().collections
        names = [c.name for c in existing]
        if settings.qdrant_collection not in names:
            client.create_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=qdrant_models.VectorParams(
                    size=VECTOR_DIM,
                    distance=qdrant_models.Distance.COSINE,
                ),
            )
            logger.info("Created Qdrant collection: %s", settings.qdrant_collection)

    async def store_state(
        self,
        asset: str,
        timeframe: str,
        timestamp,
        features: Dict[str, float],
        outcome: float = 0.0,
    ) -> None:
        await self.ensure_collection()
        client = self._get_client()

        vector_id = str(uuid.uuid4())
        vec = embed_state(features)

        payload = {
            "asset": asset,
            "timeframe": timeframe,
            "trade_outcome": "win" if outcome > 0 else ("loss" if outcome < 0 else "open"),
            "risk_reward": float(outcome),
            "context_summary": "",
            "regime": "",
        }

        client.upsert(
            collection_name=settings.qdrant_collection,
            points=[
                qdrant_models.PointStruct(
                    id=vector_id,
                    vector=vec.tolist(),
                    payload=payload,
                )
            ],
        )

    async def store_state_full(
        self,
        session: AsyncSession,
        asset: str,
        timestamp,
        regime: Optional[str],
        features: Dict[str, float],
        context_summary: Optional[str] = None,
        trade_outcome: Optional[str] = None,
        risk_reward: Optional[float] = None,
    ) -> RagDocument:
        """Full store_state: persist to both Qdrant and the RagDocument table."""
        await self.ensure_collection()
        client = self._get_client()

        vector_id = str(uuid.uuid4())
        vec = embed_state(features)

        payload = {
            "asset": asset,
            "regime": regime or "",
            "trade_outcome": trade_outcome or "",
            "risk_reward": float(risk_reward) if risk_reward is not None else 0.0,
            "context_summary": context_summary or "",
        }

        client.upsert(
            collection_name=settings.qdrant_collection,
            points=[
                qdrant_models.PointStruct(
                    id=vector_id,
                    vector=vec.tolist(),
                    payload=payload,
                )
            ],
        )

        doc = RagDocument(
            asset=asset,
            timestamp=timestamp,
            regime=regime,
            features_json=json.dumps(features),
            context_summary=context_summary,
            trade_outcome=trade_outcome,
            risk_reward=risk_reward,
            vector_id=vector_id,
        )
        session.add(doc)
        await session.flush()
        return doc

    def retrieve_similar(
        self,
        features: Dict[str, float],
        top_k: int = 3,
        asset_filter: Optional[str] = None,
        min_score: Optional[float] = None,
    ) -> List[Dict]:
        """
        Retrieve top_k most similar past market states from Qdrant.
        Results with score < min_score (default: settings.rag_min_score) are dropped.
        Returns list of payload dicts with similarity scores.
        """
        effective_min_score = min_score if min_score is not None else settings.rag_min_score
        try:
            client = self._get_client()
            vec = embed_state(features)

            # Only query if we have a meaningful vector
            if np.linalg.norm(vec) < 1e-9:
                return []

            query_filter = None
            if asset_filter:
                query_filter = qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="asset",
                            match=qdrant_models.MatchValue(value=asset_filter),
                        )
                    ]
                )

            results = client.query_points(
                collection_name=settings.qdrant_collection,
                query=vec.tolist(),
                limit=top_k,
                query_filter=query_filter,
                with_payload=True,
            )

            hits = [
                {
                    "score": hit.score,
                    "asset": hit.payload.get("asset") if hit.payload else None,
                    "regime": hit.payload.get("regime") if hit.payload else None,
                    "trade_outcome": hit.payload.get("trade_outcome") if hit.payload else None,
                    "risk_reward": hit.payload.get("risk_reward") if hit.payload else None,
                    "context_summary": hit.payload.get("context_summary") if hit.payload else None,
                    "vector_id": hit.id,
                }
                for hit in results.points
                if hit.score >= effective_min_score  # quality gate
            ]
            return hits
        except Exception as exc:
            logger.error("RAG retrieve error: %s", exc)
            return []

    def build_rag_context(self, similar_states: List[Dict]) -> str:
        """Build a human-readable context string from similar past states."""
        if not similar_states:
            return "No similar past setups found."

        lines = ["Similar past setups:"]
        for i, s in enumerate(similar_states, 1):
            outcome = s.get("trade_outcome", "unknown")
            rr = s.get("risk_reward", 0.0)
            regime = s.get("regime", "unknown")
            score = s.get("score", 0.0)
            lines.append(
                f"  {i}. Regime={regime}, Outcome={outcome}, RR={rr:.2f}, Similarity={score:.3f}"
            )
        return "\n".join(lines)
