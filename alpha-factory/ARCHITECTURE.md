# AlphaTrade Architecture

## Vision

AlphaTrade is an autonomous crypto trading research and execution platform designed to operate with real market data, continuously search for better strategies, validate them rigorously, and promote only the strongest candidates into controlled live operation.

The platform is built around one core principle:

**be aggressively autonomous in research, and brutally conservative in capital deployment.**

AlphaTrade is not a simple trading bot. It is a full strategy lifecycle system with:

- real-time market ingestion
- data quality validation
- feature engineering
- regime detection
- signal generation
- multi-layer risk control
- execution
- autonomous strategy generation
- backtesting
- validation
- promotion and demotion of strategies
- optional AI-assisted analysis

Its goal is not to blindly trade all the time. Its goal is to continuously seek stronger, more robust, more profitable strategies while protecting capital and avoiding unsafe promotion of weak ideas.

---

## Important Reality

AlphaTrade is designed to maximize robustness, adaptability, and the probability of long-term profitability.

However:

- no architecture can guarantee profit
- no backtest can guarantee future returns
- no AI can guarantee a winning strategy
- no autonomous engine should be trusted with unrestricted capital without staged validation

What AlphaTrade can do is:

- work with real data
- search for better strategies continuously
- reject weak or unstable ideas
- validate with strict statistical and operational gates
- reduce overfitting risk
- protect capital through risk constraints
- promote only the strongest candidates gradually

This architecture is designed to support real operations only through a controlled progression:
backtest → validation → paper → micro-live → limited live → scaled live

---

## High-Level Architecture

AlphaTrade is divided into three major layers:

### 1. Core Runtime Layer

This is the always-on operational layer.

It is responsible for:

- market data ingestion
- data quality checks
- feature generation
- regime detection
- signal generation
- risk enforcement
- order execution or paper execution
- persistence
- observability

This layer must work independently of AI.

If AI is unavailable, AlphaTrade must continue to run safely.

---

### 2. Autonomous Research Layer

This is the self-improving strategy layer.

It is responsible for:

- generating new strategy candidates
- mutating existing strategies
- combining valid signal blocks
- launching backtests
- running out-of-sample validation
- performing walk-forward evaluation
- ranking candidates
- promoting or rejecting strategies

This layer is autonomous, but not reckless.

It can generate many ideas, but only a small number can survive the validation gates.

---

### 3. Optional AI Advisory Layer

This is an optional intelligence layer.

It is responsible for:

- suggesting new hypotheses
- summarizing backtest outcomes
- explaining why strategies passed or failed
- generating prompts for human review
- clustering failure patterns
- proposing new filters or combinations

AI never becomes the sole authority for real-money decisions.

AI may assist research and interpretation, but the core trading engine remains deterministic and risk-governed.

---

## Core Design Principles

### Real Data First

All operational decisions must be based on real market data from live exchange or trusted market sources.

No strategy can be promoted based only on synthetic or mocked conditions.

### Safety Before Aggression

The system is allowed to search aggressively for opportunities, but capital deployment must always remain conservative.

### Research Must Be Cheap to Reject

AlphaTrade should generate many hypotheses, but reject weak ones fast.

### Promotion Must Be Strict

A strategy is not allowed into real capital merely because it had a good backtest.

### Live Capital Is Earned

Strategies must earn the right to manage capital through multiple stages of validation.

### AI Is Helpful, Not Mandatory

The system must remain operational without AI.

### Full Auditability

Every signal, every rejection, every promotion, every live decision, and every strategy lifecycle event must be traceable.

---

## Runtime Modes

AlphaTrade supports multiple operational modes.

### Minimal Mode

Used for low-cost validation and lightweight deployment.

Includes:

- ingestion
- data quality
- features
- regime detection
- signal engine
- risk engine
- persistence
- API
- basic observability

No AI required.
No heavy research jobs always running.

### Minimal + AI Mode

Same as Minimal Mode, with optional AI advisory calls.

Used for:

- signal explanation
- strategy review
- prompt generation
- post-trade analysis

### Research Mode

Used to generate and validate new strategy candidates.

Includes:

- strategy generator
- backtest engine
- validation engine
- ranking engine
- promotion engine
- optional AI advisory

### Full Mode

Combines operational runtime and research runtime.

This mode is useful for larger infrastructure, but not required for low-cost deployment.

---

## Logical Modules

### `/core/ingestion`

Responsible for:

- fetching real market data
- maintaining current OHLCV streams
- handling multiple assets and timeframes
- storing market snapshots
- retrying on network issues
- failing safely when data is unavailable

### `/core/data_quality`

Responsible for:

- checking timestamp continuity
- detecting stale candles
- detecting missing data
- detecting corrupted or inconsistent values
- rejecting unsafe data before it contaminates features and signals

No strategy may operate if market data quality is below acceptable thresholds.

### `/core/features`

Responsible for:

- computing indicators
- generating derived features
- normalizing values
- creating strategy inputs
- generating reusable feature snapshots

Features must be deterministic and reproducible.

### `/core/regime`

Responsible for:

- classifying current market regime
- identifying trend, range, expansion, compression, high-volatility, low-volatility, and other approved states
- exposing regime state to signals and risk engines

Strategies may be regime-dependent.

### `/core/signals`

Responsible for:

- producing candidate trade signals from approved live strategies
- evaluating current feature state
- applying strategy logic
- generating traceable rationale for every signal

Every signal must record why it exists.

### `/core/risk`

Responsible for:

- blocking unsafe trades
- enforcing exposure limits
- limiting simultaneous positions
- enforcing per-asset and portfolio constraints
- daily loss limits
- weekly loss limits
- consecutive loss protection
- stale data blocks
- duplicate signal blocks
- degraded regime protections
- emergency stop

Risk always has veto power.

### `/core/execution`

Responsible for:

- paper execution or live execution
- order state tracking
- idempotency
- retry behavior
- duplicate prevention
- reconciliation with exchange
- slippage tracking
- fee-aware trade recording

Execution must be observable, auditable, and resilient.

### `/core/api`

Responsible for:

- exposing system state
- exposing current regime
- exposing strategy status
- exposing recent signals
- exposing risk events
- exposing performance snapshots

### `/core/observability`

Responsible for:

- structured logs
- metrics
- health endpoints
- event tracing
- alerting hooks

---

## Autonomous Research Modules

### `/lab/strategy_generator`

This module creates new strategy candidates.

It may use:

- parameter mutation
- block recombination
- rule search
- template expansion
- optional AI-generated hypotheses

To avoid chaos, AlphaTrade does not allow unrestricted arbitrary strategy creation.

Instead, strategy generation happens inside a controlled search space.

Each candidate strategy is built from approved components such as:

- entry logic
- confirmation logic
- regime constraints
- exit logic
- stop logic
- sizing logic
- cooldown rules
- portfolio constraints

This keeps the system explainable and testable.

### `/lab/backtest_engine`

This module evaluates strategy candidates historically.

It must simulate:

- entries and exits
- stop logic
- take profit logic
- cooldown rules
- fees
- slippage assumptions
- exposure limits
- multiple timeframes where applicable

It must generate robust metrics, including:

- total return
- drawdown
- profit factor
- payoff ratio
- win rate
- trade count
- stability across periods
- volatility of outcomes

### `/lab/validation_engine`

This module exists to prevent false confidence.

It performs:

- out-of-sample testing
- walk-forward testing
- regime-diversified validation
- stress tests
- sensitivity analysis
- parameter robustness checks
- degraded execution assumptions

A strategy that performs well only in narrow or overfit conditions must be rejected here.

### `/lab/ranking_engine`

This module compares validated candidates against:

- current baseline strategies
- existing live strategies
- recent paper candidates

Ranking must consider not only raw return, but also:

- drawdown
- robustness
- consistency
- complexity
- regime fitness
- operational simplicity

### `/lab/promotion_engine`

This module controls lifecycle status.

Allowed statuses:

- `draft`
- `candidate`
- `validated`
- `paper`
- `micro_live`
- `live_limited`
- `live`
- `degraded`
- `retired`

No strategy jumps directly from candidate to full live.

### `/lab/memory`

This module stores the system's evolving memory.

It should persist:

- strategy definitions
- parameter sets
- origin of strategy
- backtest metrics
- validation metrics
- paper metrics
- live metrics
- reasons for rejection
- reasons for promotion
- degradation events

This is what allows AlphaTrade to become self-feeding and self-improving over time.

---

## Optional AI Advisory Layer

### `/ai/advisor`

The AI advisory layer is optional and must never be a hard dependency for safe runtime.

It may provide:

- signal explanation
- market summaries
- failure pattern analysis
- candidate strategy suggestions
- prompt generation for external review
- natural language summaries of backtests

Supported model providers may include:

- none
- deepseek
- gemini
- openrouter
- groq
- other external APIs

AI calls must use:

- short timeout
- bounded retries
- safe fallback
- non-blocking failure handling

If AI is unavailable, the system must continue to operate normally.

---

## Strategy Lifecycle

The AlphaTrade strategy lifecycle is the center of the system.

### Step 1: Data Collection

The system continuously ingests real market data and stores relevant operational outcomes.

### Step 2: Candidate Generation

The strategy generator creates new hypotheses using approved search rules.

### Step 3: Historical Backtesting

Each candidate is tested against historical data.

### Step 4: Validation

Candidates must survive statistical and operational validation gates.

### Step 5: Ranking

The strongest candidates are ranked against current baselines.

### Step 6: Promotion to Paper

Promising candidates enter paper mode.

### Step 7: Promotion to Micro-Live

Only candidates that behave correctly in paper may enter micro-live with minimal capital.

### Step 8: Promotion to Limited Live

Only consistent candidates may receive controlled real capital allocation.

### Step 9: Continuous Monitoring

Live strategies are constantly monitored for degradation.

### Step 10: Demotion or Retirement

Strategies that underperform, degrade statistically, or violate safety constraints are demoted or retired.

---

## Promotion Rules

A strategy should only move forward if it meets objective thresholds.

Typical promotion conditions may include:

- minimum trade count
- acceptable drawdown
- minimum profit factor
- acceptable payoff ratio
- acceptable out-of-sample performance
- acceptable walk-forward consistency
- acceptable operational simplicity
- no dangerous dependency on fragile parameters

Paper promotion does not imply live promotion.
Micro-live promotion does not imply scaled capital.
Live allocation must be earned progressively.

---

## Demotion Rules

A strategy should be demoted or retired if:

- live performance degrades materially
- drawdown exceeds allowed limits
- market regime fit breaks down
- execution quality becomes poor
- slippage becomes unacceptable
- signal quality collapses
- parameter sensitivity proves too fragile
- risk violations increase

A system that only promotes but never demotes is not autonomous.
It is dangerous.

---

## Risk Architecture

Risk is not a single stop-loss rule.
Risk is a layered control system.

### Trade-Level Risk

- max loss per trade
- stop distance sanity
- minimum reward-to-risk
- spread and slippage protection

### Strategy-Level Risk

- max drawdown per strategy
- max simultaneous positions
- cooldown enforcement
- performance degradation detection

### Asset-Level Risk

- max allocation per asset
- regime-specific exposure constraints
- liquidity filters

### Portfolio-Level Risk

- max total exposure
- max correlated exposure
- max daily loss
- max weekly loss
- max monthly drawdown
- emergency pause

### System-Level Risk

- stale data kill switch
- exchange outage protection
- scheduler failure protection
- duplicate execution protection
- AI failure isolation

---

## Data Requirements

AlphaTrade must use real and validated data.

Minimum expectations:

- real OHLCV
- synchronized timestamps
- configurable timeframes
- stored event history
- strategy metadata
- trade results
- fee and slippage metrics
- backtest archives
- validation archives

The system should never assume that incoming data is automatically trustworthy.

---

## Profit Orientation

AlphaTrade is explicitly profit-oriented.

However, profit orientation does not mean reckless optimization for short-term returns.

The system seeks profitable strategies by optimizing for:

- robust edge
- acceptable drawdown
- repeatability
- resilience across market regimes
- low fragility
- realistic execution

The goal is not to find the best-looking backtest.
The goal is to find the strongest strategy that survives contact with reality.

---

## What This Architecture Can Realistically Deliver

If implemented correctly, this architecture can provide:

- real-data autonomous operation
- continuous strategy discovery
- continuous candidate rejection
- disciplined promotion of strong strategies
- controlled real-money deployment
- capital protection through multi-layer risk
- self-feeding memory of what works and what fails
- optional AI support without runtime dependency

---

## What This Architecture Does Not Guarantee

This architecture does not guarantee:

- profit on every cycle
- permanent winning strategies
- immunity to market regime shifts
- immunity to black swan events
- safe full-size capital deployment without staged validation
- real-world profitability solely from backtests

The architecture is designed to improve the process of finding and deploying stronger strategies, not to promise impossible certainty.

---

## Real Operation Policy

AlphaTrade should only be used in real operation under staged deployment.

Recommended path:

1. backtest
2. validation
3. paper
4. micro-live
5. limited live
6. scaled live

At every stage, promotion must be earned.

If the system is profitable in backtests but unstable in paper, it is not ready.
If it is profitable in paper but fragile in micro-live, it is not ready.
If it survives all phases with acceptable risk, then it may gradually receive more capital.

---

## Low-Cost Deployment Philosophy

To support low-cost or near-free deployment:

- the core runtime must remain lightweight
- heavy research tasks must run in scheduled batches
- AI must remain optional
- backtesting must be efficient and bounded
- the platform should avoid always-on heavy local models
- research autonomy should be strong, but infrastructure should remain lean

The system should be able to run in a minimal operational footprint while still evolving over time.

---

## Final Statement

AlphaTrade is designed to be a real-data, profit-seeking, self-improving crypto trading platform.

Its purpose is to continuously search for the best strategies it can find, reject fragile ideas, validate serious candidates, and promote only the strongest strategies into progressively more real conditions.

It is built for autonomy, but not blind autonomy.
It is built for profit, but not reckless profit-chasing.
It is built for real operation, but only through strict staged validation.

That is what makes AlphaTrade mature.