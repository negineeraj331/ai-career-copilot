import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

/**
 * Reordering with three independent affordances (docs/09 §4).
 *
 * Pointer drag, a keyboard lift-and-move protocol, and plain Move up / Move
 * down buttons. The keyboard path is not a fallback — docs/09 calls drag-only
 * reordering an accessibility failure rather than a gap, and the buttons serve
 * anyone who wants neither drag nor a modal keyboard protocol.
 *
 * Native HTML5 drag rather than a drag library: this is one vertical list, and
 * a library would cost more of the 250 KB bundle budget than the interaction is
 * worth. Revisit if nested or cross-list dragging ever lands.
 */

export interface ReorderItem {
  key: string;
  label: string;
  hidden: boolean;
}

interface SectionReorderProps {
  items: ReorderItem[];
  onReorder: (keys: string[]) => void;
  onToggleHidden: (key: string) => void;
  activeKey: string;
  onSelect: (key: string) => void;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

export function SectionReorder({
  items,
  onReorder,
  onToggleHidden,
  activeKey,
  onSelect,
}: SectionReorderProps): ReactNode {
  // The index currently "lifted" by the keyboard protocol, or null.
  const [lifted, setLifted] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /**
   * Focus is moved by querying inside this component's own list.
   *
   * An earlier version used `document.querySelector`, which reaches the whole
   * page: with two instances mounted — or, in tests, a pending animation frame
   * from a previous render — it focused a button belonging to something else,
   * and the next arrow key then acted on the wrong list. A global selector in a
   * component is an escape hatch that eventually escapes.
   */
  function rowAt(index: number): HTMLButtonElement | null | undefined {
    return listRef.current?.querySelector<HTMLButtonElement>(
      `[data-reorder-index="${String(index)}"]`,
    );
  }

  function commit(from: number, to: number, how: 'keyboard' | 'pointer'): void {
    const next = move(items, from, to);
    if (next === items) return;
    onReorder(next.map((i) => i.key));
    if (how === 'keyboard') {
      setLifted(to);
      setAnnouncement(
        `${items[from]?.label ?? 'Section'} moved to position ${String(to + 1)} of ${String(items.length)}.`,
      );
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const { key } = event;

    if (key === ' ' || key === 'Enter') {
      event.preventDefault();
      if (lifted === index) {
        setLifted(null);
        setAnnouncement(`${items[index]?.label ?? 'Section'} dropped.`);
      } else {
        setLifted(index);
        setAnnouncement(
          `${items[index]?.label ?? 'Section'} lifted. Use the arrow keys to move it, then press space to drop.`,
        );
      }
      return;
    }

    if (key === 'Escape' && lifted !== null) {
      event.preventDefault();
      setLifted(null);
      setAnnouncement('Move cancelled.');
      return;
    }

    if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = key === 'ArrowUp' ? -1 : 1;

    if (lifted === index) {
      commit(index, index + delta, 'keyboard');
      // Deferred by one frame because the list re-renders first: focusing the
      // target before React has moved it lands on the wrong row. Keeping focus
      // on the moving item is what lets a second arrow key continue the move.
      requestAnimationFrame(() => {
        rowAt(index + delta)?.focus();
      });
    } else {
      // Nothing re-renders when merely navigating, so there is nothing to wait
      // for — and deferring would make focus lag a key press behind.
      rowAt(index + delta)?.focus();
    }
  }

  return (
    <nav aria-label="Resume sections">
      {/* Announcements for the keyboard protocol. Without this the move is
          silent to a screen reader and the whole interaction is unusable. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <ol ref={listRef} className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li
            key={item.key}
            draggable
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null) commit(dragFrom.current, index, 'pointer');
              dragFrom.current = null;
            }}
            className={cn(
              'group flex items-center gap-1 rounded-lg px-1',
              lifted === index && 'ring-2 ring-[var(--accent)]',
            )}
          >
            <button
              type="button"
              data-reorder-index={index}
              aria-pressed={lifted === index}
              aria-current={activeKey === item.key ? 'true' : undefined}
              onClick={() => {
                onSelect(item.key);
              }}
              onKeyDown={(e) => {
                onKeyDown(e, index);
              }}
              className={cn(
                'flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                activeKey === item.key
                  ? 'bg-[var(--surface-raised)] font-medium'
                  : 'hover:bg-[var(--surface-raised)]',
                item.hidden && 'opacity-50',
              )}
            >
              <span aria-hidden="true" className="mr-2 cursor-grab text-[var(--text-muted)]">
                ⠿
              </span>
              {item.label}
              {item.hidden && <span className="ml-2 text-xs">(hidden)</span>}
            </button>

            {/* Always rendered, never hover-only: a control that appears on
                hover does not exist for a keyboard or touch user. */}
            <span className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                className="rounded p-1 text-xs hover:bg-[var(--surface-raised)]"
                aria-label={`Move ${item.label} up`}
                disabled={index === 0}
                onClick={() => {
                  commit(index, index - 1, 'pointer');
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded p-1 text-xs hover:bg-[var(--surface-raised)]"
                aria-label={`Move ${item.label} down`}
                disabled={index === items.length - 1}
                onClick={() => {
                  commit(index, index + 1, 'pointer');
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="rounded p-1 text-xs hover:bg-[var(--surface-raised)]"
                aria-label={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                onClick={() => {
                  onToggleHidden(item.key);
                }}
              >
                {item.hidden ? '◌' : '●'}
              </button>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
