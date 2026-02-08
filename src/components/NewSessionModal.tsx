import React, { useState } from "react";

export type NewSessionModalProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (label: string) => void;
};

export default function NewSessionModal(props: NewSessionModalProps) {
  const [label, setLabel] = useState("");

  if (!props.open) {
    return null;
  }

  const submit = () => {
    const trimmed = label.trim();
    props.onCreate(trimmed);
    setLabel("");
  };

  return (
    <div className="modal-backdrop compact">
      <div className="new-session-modal">
        <div className="modal-title">New session</div>
        <p className="modal-subtitle">Optional name. If blank, timestamp will be used.</p>

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
