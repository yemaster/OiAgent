use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Rule {
    Once {
        at: String,
    },
    Interval {
        minutes: u32,
    },
    Daily {
        time: String,
        timezone: String,
    },
    Weekly {
        time: String,
        timezone: String,
        weekdays: Vec<u32>,
    },
}
impl Rule {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Once { at } => {
                DateTime::parse_from_rfc3339(at).map_err(|_| "请选择有效的执行时间")?;
            }
            Self::Interval { minutes } if !(1..=43200).contains(minutes) => {
                return Err("执行间隔需为 1–43200 分钟".into())
            }
            Self::Daily { time, timezone } | Self::Weekly { time, timezone, .. } => {
                NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| "请选择有效的执行时间")?;
                timezone.parse::<Tz>().map_err(|_| "时区无效")?;
            }
            _ => {}
        }
        if let Self::Weekly { weekdays, .. } = self {
            if weekdays.is_empty() || weekdays.len() > 7 || weekdays.iter().any(|d| *d > 6) {
                return Err("请选择每周执行的日期".into());
            }
        }
        Ok(())
    }
    /// Strictly later than `after`. Interval anchor preserves cadence across sleep/restart.
    /// DST gaps are skipped; repeated wall times use the earlier occurrence once per date.
    pub fn next(
        &self,
        after: DateTime<Utc>,
        anchor: Option<DateTime<Utc>>,
    ) -> Option<DateTime<Utc>> {
        match self {
            Self::Once { at } => DateTime::parse_from_rfc3339(at)
                .ok()
                .map(|t| t.with_timezone(&Utc))
                .filter(|t| *t > after),
            Self::Interval { minutes } if *minutes > 0 => {
                let step = i64::from(*minutes) * 60;
                let anchor = anchor.unwrap_or(after);
                let n = if anchor > after {
                    0
                } else {
                    (after - anchor).num_seconds() / step + 1
                };
                anchor.checked_add_signed(Duration::seconds(n.checked_mul(step)?))
            }
            Self::Daily { time, timezone } | Self::Weekly { time, timezone, .. } => {
                let tz: Tz = timezone.parse().ok()?;
                let time = NaiveTime::parse_from_str(time, "%H:%M").ok()?;
                let date = after.with_timezone(&tz).date_naive();
                // Covers an entire week plus a DST-skipped weekly occurrence.
                for offset in 0..16 {
                    let day = date.checked_add_signed(Duration::days(offset))?;
                    if let Self::Weekly { weekdays, .. } = self {
                        if !weekdays.contains(&day.weekday().num_days_from_monday()) {
                            continue;
                        }
                    }
                    let next = match tz.from_local_datetime(&day.and_time(time)) {
                        LocalResult::Single(t) => t,
                        LocalResult::Ambiguous(a, b) => a.min(b),
                        LocalResult::None => continue,
                    }
                    .with_timezone(&Utc);
                    if next > after {
                        return Some(next);
                    }
                }
                None
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn utc(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }
    #[test]
    fn calendar_uses_saved_timezone_and_selected_weekdays() {
        let rule = Rule::Weekly {
            time: "09:00".into(),
            timezone: "Asia/Shanghai".into(),
            weekdays: vec![0, 4],
        };
        assert_eq!(
            rule.next(utc("2026-10-23T01:00:00Z"), None),
            Some(utc("2026-10-26T01:00:00Z"))
        );
    }
    #[test]
    fn interval_skips_backlog_without_drifting() {
        let rule = Rule::Interval { minutes: 90 };
        assert_eq!(
            rule.next(
                utc("2026-10-24T07:12:00Z"),
                Some(utc("2026-10-23T01:00:00Z"))
            ),
            Some(utc("2026-10-24T08:30:00Z"))
        );
    }
    #[test]
    fn dst_gap_skips_date_and_fallback_never_runs_twice() {
        let spring = Rule::Daily {
            time: "02:30".into(),
            timezone: "America/New_York".into(),
        };
        assert_eq!(
            spring.next(utc("2026-03-08T05:00:00Z"), None),
            Some(utc("2026-03-09T06:30:00Z"))
        );
        let autumn = Rule::Daily {
            time: "01:30".into(),
            timezone: "America/New_York".into(),
        };
        assert_eq!(
            autumn.next(utc("2026-11-01T05:30:00Z"), None),
            Some(utc("2026-11-02T06:30:00Z"))
        );
    }
    #[test]
    fn once_is_not_repeated_and_bad_inputs_are_rejected() {
        let rule = Rule::Once {
            at: "2026-10-25T08:00:00+08:00".into(),
        };
        assert!(rule.next(utc("2026-10-25T00:00:00Z"), None).is_none());
        assert!(Rule::Interval { minutes: 0 }.validate().is_err());
        assert!(Rule::Daily {
            time: "24:30".into(),
            timezone: "Asia/Shanghai".into()
        }
        .validate()
        .is_err());
        assert!(Rule::Weekly {
            time: "09:00".into(),
            timezone: "Asia/Shanghai".into(),
            weekdays: vec![]
        }
        .validate()
        .is_err());
    }
}
