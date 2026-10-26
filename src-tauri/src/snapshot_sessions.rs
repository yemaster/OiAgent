use crate::models::Task;
use std::collections::HashMap;

/// Index all owners of a native session, including sessions from Agent handoffs.
/// Built for one snapshot only; no stale task references survive a refresh.
#[derive(Default)]
pub(crate) struct SessionIndex(HashMap<String, HashMap<String, Vec<usize>>>);

impl SessionIndex {
    pub(crate) fn new(tasks: &[Task]) -> Self {
        let mut index = Self::default();
        for (position, task) in tasks.iter().enumerate() {
            index.insert(position, task);
        }
        index
    }

    pub(crate) fn insert(&mut self, position: usize, task: &Task) {
        if task.subagent_id.is_some() || task.source == "terminal" {
            return;
        }
        let sessions = task
            .session_id
            .iter()
            .map(|id| (&task.agent_kind, id))
            .chain(
                task.sessions
                    .iter()
                    .map(|session| (&session.agent_kind, &session.session_id)),
            );
        for (kind, id) in sessions {
            let owners = self
                .0
                .entry(kind.clone())
                .or_default()
                .entry(id.clone())
                .or_default();
            if owners.last() != Some(&position) {
                owners.push(position);
            }
        }
    }

    pub(crate) fn merge(&self, tasks: &mut [Task], history: &Task) -> bool {
        if history.subagent_id.is_some() {
            return false;
        }
        let Some(owners) = history.session_id.as_ref().and_then(|id| {
            self.0
                .get(&history.agent_kind)
                .and_then(|sessions| sessions.get(id))
        }) else {
            return false;
        };
        for &position in owners {
            let managed = &mut tasks[position];
            if managed.usage_by_agent.len() <= 1 && managed.agent_kind == history.agent_kind {
                managed.session_usage = Some(history.usage.clone());
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task(id: usize) -> Task {
        serde_json::from_value(json!({
            "id": id.to_string(), "title": "", "prompt": "", "project": "/repo",
            "agentId": "codex", "agentKind": "codex", "status": "completed",
            "createdAt": "", "updatedAt": "", "preview": "", "source": "managed",
            "model": "", "permission": "", "sessionId": format!("session-{}", id % 7),
            "usage": { "input": id, "output": 0, "cached": 0, "known": true }
        }))
        .unwrap()
    }

    #[test]
    fn matches_scan_semantics_for_aliases_subagents_terminals_and_multiple_owners() {
        let mut tasks: Vec<_> = (0..100).map(task).collect();
        for (i, task) in tasks.iter_mut().enumerate() {
            if i % 3 == 0 {
                task.agent_kind = "claude".into();
            }
            if i % 5 == 0 {
                task.source = "terminal".into();
            }
            if i % 11 == 0 {
                task.subagent_id = Some("child".into());
            }
            if i % 13 == 0 {
                task.session_id = None;
            }
            if i % 2 == 0 {
                task.sessions = serde_json::from_value(json!([
                    { "agentId": "codex", "agentKind": "codex", "sessionId": "session-1" },
                    { "agentId": "codex", "agentKind": "codex", "sessionId": "session-1" }
                ]))
                .unwrap();
            }
            if i % 17 == 0 {
                task.usage_by_agent
                    .insert("claude".into(), Default::default());
                task.usage_by_agent
                    .insert("codex".into(), Default::default());
            }
        }
        let mut expected = tasks.clone();
        let mut index = SessionIndex::new(&tasks);
        for i in 100..150 {
            let mut history = task(i);
            if i % 4 == 0 {
                history.agent_kind = "qodercn".into();
            }
            if i % 9 == 0 {
                history.subagent_id = Some("child".into());
            }
            if i % 13 == 0 {
                history.session_id = None;
            }
            let mut matched = false;
            for managed in expected.iter_mut().filter(|managed| {
                history.subagent_id.is_none()
                    && managed.subagent_id.is_none()
                    && managed.source != "terminal"
                    && history.session_id.is_some()
                    && ((managed.agent_kind == history.agent_kind
                        && managed.session_id == history.session_id)
                        || managed.sessions.iter().any(|session| {
                            session.agent_kind == history.agent_kind
                                && Some(&session.session_id) == history.session_id.as_ref()
                        }))
            }) {
                matched = true;
                if managed.usage_by_agent.len() <= 1 && managed.agent_kind == history.agent_kind {
                    managed.session_usage = Some(history.usage.clone());
                }
            }
            assert_eq!(index.merge(&mut tasks, &history), matched);
            if !matched {
                index.insert(tasks.len(), &history);
                tasks.push(history.clone());
                expected.push(history);
            }
        }
        assert_eq!(
            serde_json::to_value(tasks).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
}
