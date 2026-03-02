import React, { useEffect, useState } from "react";

type AgentOption = {
  id: string;
  label: string;
};

type ModelOption = {
  id: string;
  name: string;
  provider: string;
};

export type NewSessionModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (label: string, agentId?: string | null, modelId?: string | null) => void;
  agentOptions?: AgentOption[];
  defaultAgentId?: string | null;
  defaultAgentLabel?: string | null;
  models?: ModelOption[];
  preferredModel?: string | null;
  onPreferredModelChange?: (model: string | null) => void;
};

export default function NewSessionModal(props: NewSessionModalProps) {
  const [label, setLabel] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    if (props.open) {
      setSelectedModel(props.preferredModel ?? "");
    } else {
      setLabel("");
      setSelectedAgentId("");
      setSelectedModel("");
    }
  }, [props.open, props.preferredModel]);

  if (!props.open) {
    return null;
  }

  const submit = () => {
    const trimmed = label.trim();
    const agentId = selectedAgentId.trim();
    const model = selectedModel.trim();
    props.onCreate(trimmed, agentId || null, model || null);
    // Persist model choice as the new preferred model
    if (props.onPreferredModelChange) {
      props.onPreferredModelChange(model || null);
    }
    setLabel("");
    setSelectedAgentId("");
    setSelectedModel("");
  };

  const defaultAgentText =
    props.defaultAgentLabel?.trim() ||
    props.defaultAgentId?.trim() ||
    "main";

  const modelChoices = (props.models ?? []).map((m) => ({
    full: `${m.provider}/${m.id}`,
    ...m,
  }));

  return (
    <div className="modal-backdrop compact">
      <div className="new-session-modal">
        <div className="modal-title">New session</div>
        <p className="modal-subtitle">
          Optional name. If blank, timestamp will be used. Model choice is remembered for next time.
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

        <div className="field-label">Model</div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="ui-input"
          aria-label="Select model for new session"
        >
          <option value="">System default</option>
          {modelChoices.map((model) => (
            <option key={model.full} value={model.full}>
              {model.full}
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
