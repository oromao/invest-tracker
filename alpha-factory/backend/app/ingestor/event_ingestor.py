import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from app.db.models import EventSummary, RagDocument
from app.db.session import async_session_factory
from app.signals.rag import RagStore

logger = logging.getLogger(__name__)

class EventIngestor:
    def __init__(self):
        self.rag_store = RagStore()

    async def add_event(
        self,
        summary: str,
        event_type: str = "macro",
        sentiment: float = 0.0,
        impact_score: int = 3,
        source: Optional[str] = None,
        ingest_to_rag: bool = True
    ):
        """Add a manual or automated market event."""
        async with async_session_factory() as session:
            event = EventSummary(
                timestamp=datetime.now(tz=timezone.utc),
                event_type=event_type,
                source=source,
                summary=summary,
                sentiment=sentiment,
                impact_score=impact_score,
                is_ingested_to_rag=0
            )
            session.add(event)
            await session.commit()
            
            if ingest_to_rag:
                await self.sync_to_rag()

    async def sync_to_rag(self):
        """Sync pending event_summaries to RagDocuments / Qdrant."""
        async with async_session_factory() as session:
            stmt = select(EventSummary).where(EventSummary.is_ingested_to_rag == 0)
            result = await session.execute(stmt)
            pending = result.scalars().all()
            
            for event in pending:
                try:
                    # For RAG, we use a generic 'GLOBAL' asset for macro events
                    # We use an empty feature dict or zeros for macro-only events
                    market_features = {
                        "sentiment": event.sentiment,
                        "impact": float(event.impact_score)
                    }
                    
                    await self.rag_store.store_state_full(
                        session=session,
                        asset="GLOBAL",
                        timestamp=event.timestamp,
                        regime="EVENT",
                        market_features=market_features,
                        context_summary=f"[{event.event_type.upper()}] {event.summary}",
                        trade_outcome="N/A",
                        risk_reward=0.0
                    )
                    event.is_ingested_to_rag = 1
                    logger.info("Synced event to RAG: %s", event.summary[:50])
                except Exception as e:
                    logger.error("Error syncing event %d to RAG: %s", event.id, e)
            
            await session.commit()

if __name__ == "__main__":
    # Example usage
    import asyncio
    ingestor = EventIngestor()
    asyncio.run(ingestor.add_event(
        summary="US CPI report shows 3.1% inflation, slightly higher than expected. Volatility expected.",
        event_type="macro",
        sentiment=-0.4,
        impact_score=4,
        source="Bloomberg"
    ))
