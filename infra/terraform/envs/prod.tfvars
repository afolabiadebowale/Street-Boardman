# Low-cost for the DEMO-money pilot. Before APP_MODE=PRODUCTION (real money),
# flip the HA settings marked below — no rewrite needed.
environment = "prod"
domain_name = "app.example.com" # TODO
# route53_zone_id = "Z0123456789ABC"

app_mode = "DEMO"
# Admin tools need MFA + 12-char passwords from this date (grace period until then).
# staff_security_enforced_from = "2026-11-01"

db_backup_retention_days = 14
db_deletion_protection   = true
alert_emails             = [] # TODO: at least two people

# --- High availability: turn on before real money ---
db_multi_az       = false # true: standby DB in a second AZ, automatic failover
api_desired_count = 1     # 2: one API task per AZ
web_desired_count = 1     # 2
use_nat_gateway   = false # true: app tasks move to private subnets
enable_waf        = false # true: managed attack rules + per-IP ceiling

log_retention_days = 365 # financial app: a year of logs for investigations and audits
