import React, { useEffect, useState } from "react";

type AgentOption = {
  id: string;
  label: string;
};

export type NewSessionModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (label: string, agentId?: string | null) => void;
  agentOptions?: AgentOption[];
  defaultAgentId?: string | null;
  defaultAgentLabel?: string | null;
};

export default function NewSessionModal(props: NewSessionModalProps) {
  const [label, setLabel] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");

  useEffect(() => {
    if (!props.open) {
      setLabel("");
      setSelectedAgentId("");
    }
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const submit = () => {
    const trimmed = label.trim();
    const agentId = selectedAgentId.trim();
    props.onCreate(trimmed, agentId || null);
    setLabel("");
    setSelectedAgentId("");
  };

  const defaultAgentText =
    props.defaultAgentLabel?.trim() ||
    props.defaultAgentId?.trim() ||
    "main";

  return (
    <div className="modal-backdrop compact">
      <div className="new-session-modal">
        <div className="modal-title">New session</div>
        <p className="modal-subtitle">
          Optional name. If blank, timestamp will be used. Leave agent on Default to use the default
          agent automatically.
        </p>

        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="ui-input"
          placeholder="e.g. Sprint planning"
        />

        <div className="field-label">Agent</div>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="ui-input"
          aria-label="Select agent for new session"
        >
          <option value="">Default ({defaultAgentText})</option>
          {(props.agentOptions ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.label} ({agent.id})
            </option>
          ))}
        </select>

        <div className="new-session-actions">
          <button type="button" onClick={props.onClose} className="ui-btn ui-btn-light">
            Cancel
          </button>
          <button type="button" onClick={submit} className="ui-btn ui-btn-primary">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
