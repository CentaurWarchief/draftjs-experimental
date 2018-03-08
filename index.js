import "draft-js/dist/Draft.css";

import { Editor, EditorState } from "draft-js";

import React from "react";
import ReactDOM from "react-dom";
import { Value } from "react-powerplug";

function DraftExperimental() {
  return (
    <div style={{ padding: 20 }}>
      <Value initial={EditorState.createEmpty()}>
        {({ value: editorState, setValue: onChange }) => (
          <Editor
            placeholder="What's up?"
            editorState={editorState}
            onChange={onChange}
          />
        )}
      </Value>
    </div>
  );
}

const DOM_NODE = document.querySelector("#app");

ReactDOM.render(<DraftExperimental />, DOM_NODE);
