/**
 * The leaderboard used by the season board and the Daily Rally page: the top three on a podium, then
 * ten rows a page in a tight table, and the signed-in racer's own row pinned under it with a jump to
 * their page. Presentational only: each page passes the rows it already has.
 */
import type { ReactNode } from 'react';
import { Pager } from './Pager';
import './leaderboard.css';

export interface BoardRow {
  rank: number;
  key: string;
  name: string;
  /** small things after the name: streak badges, a "Cup seat" tag */
  extra?: ReactNode;
  points: number;
  /** the middle columns, in the order of `columns` */
  stats: (number | string)[];
  me?: boolean;
}

/** Rows a page under the podium. */
export const BOARD_PAGE = 10;
/** Ranks shown on the podium; the table starts after them. */
export const PODIUM = 3;

/** Ranks shown in the table on a page (page 1 starts after the podium). */
export function pageRanks(page: number): [number, number] {
  const first = PODIUM + 1 + (page - 1) * BOARD_PAGE;
  return [first, first + BOARD_PAGE - 1];
}

export const boardPages = (total: number) => Math.max(1, Math.ceil(Math.max(0, total - PODIUM) / BOARD_PAGE));

interface Props {
  columns: string[];
  /** ranks 1-3 (shown on page 1) */
  podium: BoardRow[];
  /** this page's table rows */
  rows: BoardRow[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  /** the signed-in racer, when on the board */
  mine?: BoardRow | null;
  /** a line under the podium, e.g. who keeps a Cup seat */
  note?: ReactNode;
  /** narrow column (Daily Rally side card) */
  compact?: boolean;
  loading?: boolean;
  empty?: string;
  pointsLabel?: string;
}

const MEDAL = ['gold', 'silver', 'bronze'];

export function LeaderBoard({ columns, podium, rows, total, page, onPage, mine, note, compact, loading, empty = 'No points yet.', pointsLabel = 'Pts' }: Props) {
  const pages = boardPages(total);
  const [first] = pageRanks(page);
  const last = Math.min(total, first + rows.length - 1);
  const mineShown = !!mine && (mine.rank <= PODIUM ? page === 1 : rows.some(r => r.key === mine.key));
  const mineLabel = mine && (
    <div className="lbx-mine">
      <span>You</span>
      <b>#{mine.rank}</b>
      <em>{mine.points} {pointsLabel.toLowerCase()}</em>
      {!mineShown && mine.rank > PODIUM && (
        <button type="button" onClick={() => onPage(Math.floor((mine.rank - PODIUM - 1) / BOARD_PAGE) + 1)}>Show my place</button>
      )}
    </div>
  );

  if (loading) return <div className={`lbx ${compact ? 'compact' : ''}`}><div className="lbx-empty"><span className="rr-spinner" /></div></div>;
  if (total === 0) return <div className={`lbx ${compact ? 'compact' : ''}`}><div className="lbx-empty">{empty}</div></div>;

  return (
    <div className={`lbx ${compact ? 'compact' : ''}`}>
      {page === 1 && podium.length > 0 && (
        <div className="lbx-podium">
          {[podium[1], podium[0], podium[2]].filter(Boolean).map(r => (
            <div key={r.key} className={`lbx-step p${r.rank} ${r.me ? 'me' : ''}`}>
              <span className={`lbx-medal ${MEDAL[r.rank - 1]}`}>{r.rank}</span>
              <strong title={r.name}>{r.name}</strong>
              {r.extra && <span className="lbx-extra">{r.extra}</span>}
              <b>{r.points}<small>{pointsLabel}</small></b>
            </div>
          ))}
        </div>
      )}
      {note && <p className="lbx-note">{note}</p>}

      {rows.length > 0 && (
        <div className="lbx-table" role="table" style={{ ['--cols' as string]: columns.length }}>
          <div className="lbx-row head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Racer</span>
            {columns.map(c => <span key={c} role="columnheader" className="num">{c}</span>)}
            <span role="columnheader" className="num">{pointsLabel}</span>
          </div>
          {rows.map(r => (
            <div key={r.key} role="row" className={`lbx-row ${r.me ? 'me' : ''}`}>
              <span className="rank">{r.rank}</span>
              <span className="name"><i title={r.name}>{r.name}</i>{r.extra}</span>
              {r.stats.map((s, i) => <span key={i} className="num dim">{s}</span>)}
              <b className="num">{r.points}</b>
            </div>
          ))}
        </div>
      )}

      <div className="lbx-foot">
        <span className="lbx-range">{rows.length > 0 ? `${first}–${last} of ${total.toLocaleString('en-US')}` : `Top ${Math.min(PODIUM, total)} of ${total.toLocaleString('en-US')}`}</span>
        <Pager page={page} pages={pages} onPage={onPage} label="Leaderboard pages" />
        {mineLabel}
      </div>
    </div>
  );
}
