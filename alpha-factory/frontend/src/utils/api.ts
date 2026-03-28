import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const fetchSignals = async () => {
  const { data } = await api.get("/api/signals");
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

export const fetchPortfolio = async () => {
  const { data } = await api.get("/api/portfolio");
  return data;
};
