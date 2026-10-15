import type { JSX } from 'react';
import { GlassSelect } from './GlassSelect';

/** Preserved index layout — React owns this markup. */
export function RecentModelsDialog(): JSX.Element {
  return (
    <section id="recentModal" className="recent-modal" role="dialog" aria-modal="true" aria-labelledby="recentModalTitle" hidden={true}>
      <button id="recentModalBackdrop" className="recent-modal__backdrop" type="button" aria-label="Close recent models panel"></button>
      <div className="recent-modal__panel">
        <div className="recent-modal__header">
          <div>
            <div className="panel-label">
              {"07 / BROWSER STORAGE"}
            </div>
            <h2 id="recentModalTitle">
              {"RECENT "}
              <span>
                {"MODELS"}
              </span>
            </h2>
          </div>
          <button id="closeRecentModal" className="modal-close recent-modal__close" type="button" aria-label="Close recent models panel">
            {"×"}
          </button>
        </div>
        <div className="recent-modal__intro-row">
          <p>
            {"Your saved models stay here until you delete them. Open any build to continue editing."}
          </p>
          <button id="clearRecentModels" className="recent-clear" type="button">
            {"CLEAR RECENTS"}
          </button>
        </div>
        <div className="recent-library-actions">
          <button id="backupProjectLibrary" type="button">BACKUP LIBRARY / ZIP ↗</button>
          <button id="restoreProjectLibrary" type="button">RESTORE LIBRARY ↗</button>
          <input id="restoreProjectLibraryFile" type="file" accept=".zip,application/zip" hidden aria-label="Choose Build It Live library backup" />
        </div>
        <p id="projectLibraryStatus" className="recent-library-status" role="status" aria-live="polite">Backup includes both builders and saved checkpoints.</p>
        <div className="recent-organize"><label>FIND A PROJECT<input id="recentProjectSearch" type="search" placeholder="Search model names…" autoComplete="off" /></label><div><label htmlFor="recentProjectSort">SORT PROJECTS</label><select id="recentProjectSort" className="glass-select__native" aria-hidden="true" tabIndex={-1}><option value="latest">Latest saved</option><option value="oldest">Oldest saved</option><option value="name">Name A–Z</option><option value="blocks">Most blocks</option></select><GlassSelect selectId="recentProjectSort" caption="Sort projects" /></div></div>
        <p id="recentSearchCount" className="recent-search-count" role="status"></p>
        <div id="recentModelsList" className="recent-list" aria-live="polite"></div>
        <div className="recent-modal__note">
          <strong>
            {"PROJECT LIBRARY / STORED ON THIS DEVICE"}
          </strong>
          <span>
            {"Projects survive restarts in this browser. Use .BIL backups before clearing browser data or changing devices."}
          </span>
        </div>
      </div>
    </section>
  );
}
