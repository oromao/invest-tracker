"""Optional AI client with safe fallbacks.

AI is opt-in. When disabled or unavailable, the runtime must continue with
deterministic template-based narratives.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Tuple

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_CLIENTS: dict[Tuple[str, str], AsyncOpenAI] = {}


def _provider_config() -> tuple[str, str, str]:
    provider = (settings.ai_provider or "none").strip().lower()
    if not settings.ai_enabled or provider in {"", "none", "off", "disabled"}:
        return "none", "", ""

    if provider == "ollama":
        return provider, f"{settings.ollama_url}/v1", "ollama"
    if provider == "deepseek":
        return provider, "https://api.deepseek.com/v1", settings.deepseek_api_key
    if provider == "gemini":
        return provider, "https://generativelanguage.googleapis.com/v1beta/openai/", settings.gemini_api_key
    if provider == "openrouter":
        return provider, "https://openrouter.ai/api/v1", settings.openrouter_api_key
    if provider == "groq":
        return provider, "https://api.groq.com/openai/v1", settings.groq_api_key

    logger.warning("Unknown AI provider '%s'; falling back to template mode.", provider)
    return "none", "", ""


def get_client(provider: str, base_url: str, api_key: str) -> AsyncOpenAI:
    key = (provider, base_url)
    client = _CLIENTS.get(key)
    if client is None:
        client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key or "dummy",
            timeout=settings.ai_timeout_seconds,
        )
        _CLIENTS[key] = client
    return client


def _provider_model(provider: str) -> str:
    if provider == "deepseek":
        return settings.ai_model or "deepseek-chat"
    if provider == "gemini":
        return settings.ai_model or "gemini-2.0-flash"
    if provider == "openrouter":
        return settings.ai_model or "openai/gpt-4o-mini"
    if provider == "groq":
        return settings.ai_model or "llama-3.1-70b-versatile"
    return settings.ai_model or settings.ollama_model


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
    Generate a human-readable narrative for a trading signal.
    Returns a fallback string if AI is disabled or unavailable.
    """
    provider, base_url, api_key = _provider_config()
    if provider == "none":
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

    model = _provider_model(provider)
    client = get_client(provider, base_url, api_key)

    last_exc: Exception | None = None
    for attempt in range(max(1, settings.ai_retries + 1)):
        try:
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    max_tokens=120,
                ),
                timeout=settings.ai_timeout_seconds,
            )
            narrative = (response.choices[0].message.content or "").strip()
            if narrative:
                logger.debug("AI narrative via %s for %s: %s", provider, asset, narrative)
                return narrative
        except Exception as exc:
            last_exc = exc
            if attempt < settings.ai_retries:
                await asyncio.sleep(min(0.5 * (attempt + 1), 2.0))
                continue
            break

    if last_exc:
        logger.warning("AI provider %s unavailable, using template fallback: %s", provider, last_exc)
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
