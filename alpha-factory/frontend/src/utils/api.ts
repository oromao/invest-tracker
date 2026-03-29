import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const fetchSignals = async () => {
  const { data } = await api.get("/api/signals");
  return data;
};

export const generateSignals = async (payload: { asset?: string | null; timeframe?: string } = {}) => {
  const { data } = await api.post("/api/signals/generate", payload);
  return data;
};

export const fetchRegimes = async () => {
  const { data } = await api.get("/api/regimes");
  return data;
};

export const fetchStrategies = async () => {
  const { data } = await api.get("/api/research/strategies");
  return data;
};

export const runResearchCycle = async (payload: { asset: string; timeframe: string }) => {
  const { data } = await api.post("/api/research/run", payload);
  return data;
};

export const promoteStrategy = async (strategyId: string) => {
  const { data } = await api.patch(`/api/research/strategies/${strategyId}/promote`);
  return data;
};

export const deprecateStrategy = async (strategyId: string) => {
  const { data } = await api.patch(`/api/research/strategies/${strategyId}/deprecate`);
  return data;
};

export const fetchBacktests = async () => {
  const { data } = await api.get("/api/backtests");
  return data;
};

export const runBacktest = async (params: { strategy_id: string; asset: string; timeframe: string }) => {
  const { data } = await api.post("/api/backtests/run", params);
  return data;
};

export const fetchPortfolio = async () => {
  const { data } = await api.get("/api/portfolio");
  return data;
};
