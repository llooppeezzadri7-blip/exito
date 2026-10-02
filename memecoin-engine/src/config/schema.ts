import { z } from "zod";

const tier = z.object({
  interval_sec: z.number().int().positive(),
  ttl_hours: z.number().positive(),
  providers: z.array(z.string()),
});

export const configSchema = z
  .object({
    engine: z.object({
      chains: z.array(z.enum(["solana", "ethereum", "base", "bsc", "avalanche"])).min(1),
      mode: z.enum(["read_only", "paper"]),
      timezone: z.string().default("UTC"),
    }),
    discovery: z.object({
      poll_interval_sec: z.number().int().min(10),
      max_new_tokens_per_cycle: z.number().int().min(1),
      min_age_minutes: z.number().min(0),
      max_age_minutes: z.number().positive(),
      sources: z.object({
        dexscreener_profiles: z.boolean(),
        dexscreener_boosts: z.boolean(),
        geckoterminal_new_pools: z.boolean(),
        pumpportal_ws: z.boolean(),
        rugcheck_new_tokens: z.boolean(),
      }),
    }),
    tiers: z.object({
      1: tier,
      2: tier,
      3: tier,
      4: tier,
      promote: z.object({
        to_2_min_liquidity_usd: z.number(),
        to_2_min_volume_h1_usd: z.number(),
        to_3_min_score: z.number(),
        to_3_min_early_momentum: z.number(),
        to_4_min_score: z.number(),
      }),
      demote_after_cycles_below: z.number().int().positive(),
    }),
    filters: z.object({
      min_liquidity_usd: z.number(),
      max_top10_holder_pct: z.number(),
      max_single_holder_pct_excl_lp: z.number(),
      reject_if_freeze_authority: z.boolean(),
      reject_if_mint_authority: z.boolean(),
      min_holders: z.number(),
      min_unique_buyers_h1: z.number(),
      min_data_quality: z.number().min(0).max(1),
    }),
    risk_gates: z.object({
      max_rug_risk_for_opportunity: z.number(),
      max_exit_risk_for_opportunity: z.number(),
      min_data_quality_for_opportunity: z.number(),
      min_security_score: z.number(),
      high_conviction_min_score: z.number(),
      high_conviction_min_independent_signals: z.number().int(),
      watchlist_min_score: z.number(),
      extreme_risk_rug_threshold: z.number(),
    }),
    scoring: z.object({
      weights: z.object({
        early_momentum: z.number(),
        holder_growth: z.number(),
        liquidity: z.number(),
        social_momentum: z.number(),
        narrative: z.number(),
        market_quality: z.number(),
        security: z.number(),
        deployer: z.number(),
        wallet_quality: z.number(),
      }),
      penalties: z.object({
        wallet_concentration_max: z.number(),
        deployer_uncertainty_max: z.number(),
        exit_risk_max: z.number(),
        late_phase_max: z.number(),
        exhausted_phase_max: z.number(),
        narrative_saturation_max: z.number(),
        anomaly_max: z.number(),
        conflict_max: z.number(),
      }),
      confidence: z.object({
        min_snapshots_for_medium: z.number().int(),
        min_snapshots_for_high: z.number().int(),
        min_data_quality_for_high: z.number(),
      }),
    }),
    no_fomo: z.object({
      late_if_price_change_h1_pct: z.number(),
      late_if_price_change_h24_pct: z.number(),
      exhausted_if_volume_drop_pct: z.number(),
      exhausted_if_price_from_ath_pct: z.number(),
      vertical_pump_m5_pct: z.number(),
    }),
    liquidity: z.object({
      healthy_liq_to_mc_min: z.number(),
      healthy_liq_to_mc_max: z.number(),
      drop_alert_pct: z.number(),
      suspicious_volume_to_liq_ratio: z.number(),
    }),
    holders: z.object({
      whale_pct: z.number(),
      cluster_min_wallets: z.number().int(),
      cluster_time_window_sec: z.number(),
    }),
    social: z.object({
      spike_zscore: z.number(),
      saturation_mentions_per_hour: z.number(),
    }),
    alerts: z.object({
      cooldown_minutes: z.number(),
      max_per_hour: z.number().int(),
      min_score_for_new_high_potential: z.number(),
      channels: z.object({ telegram: z.boolean(), discord: z.boolean(), dashboard: z.boolean() }),
    }),
    paper_trading: z.object({
      enabled: z.boolean(),
      bankroll_usd: z.number().positive(),
      position_pct: z.number().positive(),
      max_open_positions: z.number().int().positive(),
      slippage_pct: z.number().min(0),
      fee_pct: z.number().min(0),
      stop_loss_pct: z.number().negative(),
      take_profit_pct: z.number().positive(),
      max_hold_hours: z.number().positive(),
      trailing_stop_pct: z.number().positive(),
    }),
    learning: z.object({
      horizons_hours: z.array(z.number().positive()).min(1),
      big_move_pct: z.number(),
      big_drop_pct: z.number(),
      min_samples_for_stats: z.number().int(),
    }),
    monitor: z.object({
      outcome_resolver_interval_sec: z.number().int(),
      health_interval_sec: z.number().int(),
      snapshot_retention_days: z.number().int(),
      queue_max_attempts: z.number().int().positive(),
      worker_concurrency: z.number().int().positive(),
      data_stale_after_sec: z.number().int().positive(),
    }),
  })
  .strict();

export type EngineConfig = z.infer<typeof configSchema>;
