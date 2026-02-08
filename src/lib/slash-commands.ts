export type SlashCommand = {
  name: string;
  description: string;
  usage?: string;
};

export const BASE_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show available commands" },
  { name: "commands", description: "List all slash commands" },
  { name: "status", description: "Show gateway status summary" },
  { name: "context", description: "Explain context usage and limits" },
  { name: "whoami", description: "Show your sender id" },
  { name: "id", description: "Alias of /whoami" },
  { name: "skill", description: "Run a skill by name", usage: "/skill <name> [input]" },
  { name: "subagents", description: "List/stop/log subagent runs", usage: "/subagents list|stop|log|info|send ..." },
  { name: "approve", description: "Approve or deny exec requests", usage: "/approve <id> allow|deny" },
  { name: "allowlist", description: "Manage allowlist entries", usage: "/allowlist [list|add|remove] ..." },
  { name: "config", description: "Show or update config", usage: "/config show|get|set|unset ..." },
  { name: "debug", description: "Set runtime debug overrides", usage: "/debug show|set|unset|reset ..." },
  { name: "tts", description: "Control text-to-speech", usage: "/tts on|off|status|provider|limit|summary|audio" },
  { name: "models", description: "List available models" },
  { name: "compact", description: "Compact current session" },
  { name: "model", description: "Set model for this session", usage: "/model provider/model" },
  { name: "queue", description: "Adjust queue settings", usage: "/queue <mode> [debounce] [cap] [drop]" },
  { name: "exec", description: "Set exec defaults", usage: "/exec host=... security=... ask=... node=..." },
  { name: "think", description: "Set thinking level", usage: "/think off|low|medium|high" },
  { name: "thinking", description: "Alias of /think" },
  { name: "t", description: "Alias of /think" },
  { name: "verbose", description: "Toggle verbose mode", usage: "/verbose on|off" },
  { name: "v", description: "Alias of /verbose" },
  { name: "reasoning", description: "Toggle reasoning", usage: "/reasoning on|off" },
  { name: "reason", description: "Alias of /reasoning" },
  { name: "elevated", description: "Toggle elevated mode", usage: "/elevated on|off|ask|full" },
  { name: "elev", description: "Alias of /elevated" },
  { name: "usage", description: "Set usage line", usage: "/usage off|tokens|full" },
  { name: "activation", description: "Set group activation mode", usage: "/activation mention|always" },
  { name: "send", description: "Set send policy", usage: "/send on|off|inherit" },
  { name: "stop", description: "Stop the current run" },
  { name: "abort", description: "Abort active run" },
  { name: "restart", description: "Restart OpenClaw (if enabled)" },
  { name: "new", description: "Create and switch to a new session" },
  { name: "reset", description: "Reset current session" },
  { name: "bash", description: "Run a shell command", usage: "/bash <command>" },
];
