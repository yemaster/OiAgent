use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cached: u64,
    pub known: bool,
}
impl Usage {
    pub fn add(&mut self, other: &Usage) {
        self.input += other.input;
        self.output += other.output;
        self.cached += other.cached;
        self.known |= other.known;
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub executable: String,
    pub args: Vec<String>,
    pub available: bool,
    pub version: String,
    pub custom: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<String>,
    pub role: String,
    pub text: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_call_id: Option<String>,
    #[serde(default)]
    pub delta: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    pub agent_id: String,
    pub permission: String,
    pub model: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    pub id: String,
    pub text: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_cursor: Option<TerminalCursor>,
    #[serde(default)]
    pub context_handoff: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub sessions: Vec<AgentSession>,
    #[serde(default)]
    pub usage_by_agent: std::collections::HashMap<String, Usage>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub queued_messages: Vec<QueuedMessage>,
    #[serde(default)]
    pub active_prompt: Option<String>,
    #[serde(default)]
    pub terminal_id: Option<String>,
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub project: String,
    pub agent_id: String,
    pub agent_kind: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub preview: String,
    pub usage: Usage,
    #[serde(default)]
    pub session_usage: Option<Usage>,
    pub session_id: Option<String>,
    pub source: String,
    pub model: String,
    pub permission: String,
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub subagent_id: Option<String>,
    #[serde(default)]
    pub subagent_name: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub history_path: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    pub title: String,
    pub prompt: String,
    pub project: String,
    pub agent_id: String,
    pub model: String,
    pub permission: String,
    pub queued: bool,
    pub resume_session: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    #[serde(default)]
    pub temporary_projects: Vec<TemporaryProject>,
    #[serde(default)]
    pub providers: Vec<ProviderProfile>,
    pub agents: Vec<Agent>,
    pub tasks: Vec<Task>,
    pub projects: Vec<String>,
    #[serde(default)]
    pub archived: Vec<String>,
    #[serde(default)]
    pub titles: std::collections::HashMap<String, String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub temporary_projects: Vec<TemporaryProject>,
    pub providers: Vec<ProviderProfile>,
    pub agents: Vec<Agent>,
    pub tasks: Vec<Task>,
    pub projects: Vec<String>,
    pub warnings: Vec<String>,
    pub data_dir: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub task: Task,
    pub messages: Vec<Message>,
    pub log: String,
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub agent_id: String,
    pub agent_kind: String,
    pub provider_id: Option<String>,
    pub session_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub auth_type: String,
    pub default_model: String,
    pub haiku_model: String,
    pub sonnet_model: String,
    pub opus_model: String,
    #[serde(default)]
    pub fable_model: String,
    #[serde(default)]
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCursor {
    #[serde(default)]
    pub finished: bool,
    pub path: Option<String>,
    pub offset: u64,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryProject {
    pub id: String,
    pub path: String,
    pub created_at: String,
    pub status: String,
    pub cleanup_after: Option<String>,
}
