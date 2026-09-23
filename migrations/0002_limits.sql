-- Per-client daily counters (src/worker/lib/quota.ts): AI coach calls and team creations per network per UTC day.
-- k is a hash of "<scope>|<IPv4 address or IPv6 /64>", never the address itself. The daily cron deletes past days.
CREATE TABLE daily_usage (
  day TEXT NOT NULL, -- UTC date, YYYY-MM-DD
  k TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, k)
);
