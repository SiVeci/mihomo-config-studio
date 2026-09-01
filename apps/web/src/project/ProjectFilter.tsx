import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { collectAllTags, collectAllTargetProfiles } from './model.js';
import type { ProjectFilterQuery, ProjectRecord } from './model.js';
import './ProjectFilter.css';

export interface ProjectFilterProps {
  readonly records: readonly ProjectRecord[];
  readonly query: ProjectFilterQuery;
  readonly onQueryChange: (query: ProjectFilterQuery) => void;
}

/**
 * FR-PROJ-07: filters the sidebar's own project list by name, tag, and
 * target profile. Purely presentational — `filterProjects` (`model.ts`)
 * does the actual filtering, so that logic stays testable independent of
 * this component, and this component owns no state of its own beyond what
 * `query`/`onQueryChange` already carry.
 */
export function ProjectFilter({ records, query, onQueryChange }: ProjectFilterProps): ReactNode {
  const allTags = collectAllTags(records);
  const allTargetProfiles = collectAllTargetProfiles(records);

  return (
    <div className="project-filter">
      <label className="project-filter__label" htmlFor="project-filter-text">
        {t('projectFilter.searchLabel')}
      </label>
      <input
        id="project-filter-text"
        type="text"
        className="project-filter__text"
        value={query.text}
        placeholder={t('projectFilter.searchPlaceholder')}
        onChange={(event) => onQueryChange({ ...query, text: event.target.value })}
      />

      {/* An empty dropdown ("every project has the same one, or none") would
          be a control that can never actually filter anything — shown only
          once there is a real choice to make. */}
      {allTags.length > 0 && (
        <>
          <label className="project-filter__label" htmlFor="project-filter-tag">
            {t('projectFilter.tagLabel')}
          </label>
          <select
            id="project-filter-tag"
            value={query.tag ?? ''}
            onChange={(event) =>
              onQueryChange({
                ...query,
                tag: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">{t('projectFilter.allTags')}</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </>
      )}

      {/* ADR-012 locks only the *first* Stable compatibility profile — every
          project has the same `targetProfile` until a second one exists, so
          this dropdown stays hidden rather than offering a choice of one. */}
      {allTargetProfiles.length > 1 && (
        <>
          <label className="project-filter__label" htmlFor="project-filter-target-profile">
            {t('projectFilter.targetProfileLabel')}
          </label>
          <select
            id="project-filter-target-profile"
            value={query.targetProfile ?? ''}
            onChange={(event) =>
              onQueryChange({
                ...query,
                targetProfile: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">{t('projectFilter.allTargetProfiles')}</option>
            {allTargetProfiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
