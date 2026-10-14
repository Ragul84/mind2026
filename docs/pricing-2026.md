# Pricing 2026: store and RevenueCat setup

The paywall (`app/subscription.tsx`) and `services/iapService.ts` reference the product IDs below.
**None of them exist in Google Play or RevenueCat yet.** Until they're created, purchases fail with "product not found".

| Plan | Product ID | Play type | Price | RevenueCat entitlement |
|---|---|---|---|---|
| Plus monthly | `mindgains_plus_monthly` | Subscription, auto-renewing base plan, P1M | ₹79 | `plus` |
| Plus annual | `mindgains_plus_annual` | Subscription, auto-renewing base plan, P1Y | ₹499 | `plus` |
| Pro monthly | `mindgains_pro_monthly_2026` | Subscription, auto-renewing base plan, P1M | ₹199 | `pro` |
| Pro annual | `mindgains_pro_annual_2026` | Subscription, auto-renewing base plan, P1Y | ₹1,299 | `pro` |
| Exam-week pass | `mindgains_exam_week` | Subscription, **prepaid** base plan, P1W (no auto-renew) | ₹19 | `pro` |

The legacy `mindgains_pro_monthly` and `mindgains_pro_annual` products stay attached to `pro` so existing subscribers keep access and can restore. They're hidden on the paywall.

Steps:
1. Play Console → Monetise → Subscriptions: create the five products and base plans above with INR prices.
2. RevenueCat → Products: import them. Entitlements: create `plus` and attach the Plus products. Attach the Pro products and the exam-week pass to the existing `pro` entitlement.
3. RevenueCat → Offerings (optional): add the products to the current offering.
4. Apply the migration `20261014130000_plus_tier_pricing.sql` (adds the `plus` tier, Plus AI limits, and the entitlement→tier mapping), then deploy `revenuecat-sync`.

Daily AI limits per tier (server: `ai_feature_limit`; client mirror: `services/aiUsageService.ts`):

| Feature | Free | Plus | Pro |
|---|---|---|---|
| MIGA messages | 10 | 60 | 150 |
| MIGA voice calls | 20 | 30 | 200 |
| Study Lab generations | 2 | 20 | 50 |
| Podcasts | 0 | 1 | 5 |
| Blueprints | 2 | 6 | 15 |
| Quiz rooms | 1 | 4 | 10 |
| Weak-area sprints | 3 | 12 | 25 |
