import type { JSX } from 'react';

/** A single accessible confirmation / naming dialog shared by both builders. */
export function ProjectActionDialog(): JSX.Element {
  return (
    <dialog id="projectActionDialog" className="project-action-dialog" aria-labelledby="projectActionTitle" aria-describedby="projectActionDescription">
      <div className="project-action-dialog__head">
        <span id="projectActionEyebrow">PROJECT LIBRARY / CONFIRM</span>
        <button id="projectActionClose" className="modal-close project-action-dialog__close" type="button" aria-label="Cancel and close dialog">×</button>
      </div>
      <h2 id="projectActionTitle">CONFIRM ACTION</h2>
      <p id="projectActionDescription"></p>
      <label id="projectActionInputLabel" className="project-action-dialog__input-label" htmlFor="projectActionInput" hidden>
        VERSION NAME
        <input id="projectActionInput" type="text" maxLength={55} autoComplete="off" />
      </label>
      <p id="projectActionWarning" className="project-action-dialog__warning" hidden></p>
      <div className="project-action-dialog__actions">
        <button id="projectActionCancel" type="button">CANCEL</button>
        <button id="projectActionConfirm" type="button">CONFIRM</button>
      </div>
    </dialog>
  );
}
