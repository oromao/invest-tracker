"""
LLM client — uses local Ollama (phi3:mini) via OpenAI-compatible API.
Falls back gracefully to template-based explanation if Ollama is unavailable.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=f"{settings.ollama_url}/v1",
            api_key="ollama",  # Ollama doesn't need a real key
        )
    return _client


async def generate_signal_narrative(
    asset: str,
    timeframe: str,
    direction: str,
    confidence: float,
    regime: Optional[str],
    features: Dict[str, float],
    similar_past: List[Dict],
    strategy_name: Optional[str],
) -> str:
    """
    Generate a human-readable narrative for a trading signal using phi3:mini.
    Returns a fallback string if Ollama is unavailable or disabled.
    """
    if not settings.llm_enabled:
        return _template_fallback(asset, direction, confidence, regime, features)

    rsi = features.get("rsi_14", 0.0)
    macd = features.get("macd_hist", 0.0)
    atr = features.get("atr_14", 0.0)
    vol_z = features.get("volume_zscore", 0.0)
    entry = features.get("close", 0.0)

    past_summary = ""
    if similar_past:
        wins = sum(1 for s in similar_past if float(s.get("outcome", 0)) > 0)
        past_summary = f"{wins}/{len(similar_past)} setups similares anteriores foram lucrativos."

    prompt = f"""Você é um analista quantitativo. Explique este sinal de trading em 2-3 frases curtas em português. Seja direto e objetivo.

Ativo: {asset} | Timeframe: {timeframe}
Direção: {direction} | Confiança: {confidence:.0%}
Regime de mercado: {regime or "indefinido"}
RSI(14): {rsi:.1f} | MACD hist: {macd:.4f} | ATR: {atr:.2f}
Volume Z-score: {vol_z:.2f} | Preço atual: {entry:.2f}
Estratégia ativa: {strategy_name or "padrão"}
{past_summary}

Explicação:"""

    try:
        client = get_client()
        response = await client.chat.completions.create(
            model=settings.ollama_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=120,
        )
        narrative = response.choices[0].message.content.strip()
        logger.debug("LLM narrative for %s: %s", asset, narrative)
        return narrative
    except Exception as exc:
        logger.warning("Ollama unavailable, using template fallback: %s", exc)
        return _template_fallback(asset, direction, confidence, regime, features)


def _template_fallback(
    asset: str,
    direction: str,
    confidence: float,
    regime: Optional[str],
    features: Dict[str, float],
) -> str:
    rsi = features.get("rsi_14", 0.0)
    entry = features.get("close", 0.0)
    regime_str = regime or "indefinido"

    if direction == "LONG":
        bias = f"RSI em {rsi:.0f} indica sobrevenda." if rsi < 35 else "Momentum positivo detectado."
    elif direction == "SHORT":
        bias = f"RSI em {rsi:.0f} indica sobrecompra." if rsi > 65 else "Momentum negativo detectado."
    else:
        return f"{asset}: Sem sinal — condições de mercado não favoráveis no regime {regime_str}."

    return (
        f"{asset} {direction} @ {entry:.2f} | Confiança {confidence:.0%}. "
        f"{bias} Regime atual: {regime_str}."
    )
