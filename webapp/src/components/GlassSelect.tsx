import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Item = { value: string; label: string; disabled: boolean };

/** A glass menu rendered at document level, outside the topbar/modal backdrop roots.
 * The original <select> stays in the DOM and remains the serial/simulator engine's
 * source of truth, including its change events and dynamically inserted options.
 */
export function GlassSelect({ selectId, caption, className = '', nativeChildren, portalTarget }: {
  selectId: string;
  caption: string;
  className?: string;
  nativeChildren?: React.ReactNode;
  portalTarget?: HTMLElement;
}) {
  const root = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [value, setValue] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 160, maxHeight: 260 });

  useEffect(() => {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    nativeRef.current = select;
    const sync = () => {
      setItems(Array.from(select.options).map(option => ({ value: option.value, label: option.textContent?.trim() || option.value, disabled: option.disabled })));
      setValue(select.value);
      setDisabled(select.disabled);
    };
    const observer = new MutationObserver(sync);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'value', 'label'] });
    select.addEventListener('change', sync);
    sync();
    return () => { observer.disconnect(); select.removeEventListener('change', sync); nativeRef.current = null; };
  }, [selectId]);

  const updatePosition = useCallback(() => {
    const trigger = root.current?.querySelector<HTMLButtonElement>('.glass-select__trigger');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimated = Math.min(296, 43 + items.length * 36 + 14);
    const bounds = portalTarget?.getBoundingClientRect();
    const ceiling = bounds ? bounds.top + 16 : 10;
    const floor = bounds ? bounds.bottom - 16 : window.innerHeight - 12;
    const roomBelow = floor - rect.bottom;
    const placeAbove = roomBelow < Math.min(estimated, 170) && rect.top > roomBelow;
    const maxHeight = Math.max(100, Math.min(296, placeAbove ? rect.top - ceiling - 7 : roomBelow));
    const width = Math.max(rect.width, selectId === 'serialBaud' ? 166 : 205);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
    setPosition({ top: placeAbove ? Math.max(ceiling, rect.top - Math.min(estimated, maxHeight) - 7) : rect.bottom + 7, left, width, maxHeight });
  }, [items.length, selectId, portalTarget]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    const observer = new ResizeObserver(reposition);
    if (root.current) observer.observe(root.current);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !document.getElementById(listId)?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, updatePosition, listId]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open || !portalTarget) return;
    const menu = document.getElementById(listId);
    if (menu instanceof HTMLElement && 'showPopover' in menu) menu.showPopover();
    return () => { if (menu instanceof HTMLElement && menu.matches(':popover-open')) menu.hidePopover(); };
  }, [open, portalTarget, listId]);

  const choose = (next: string) => {
    const select = nativeRef.current;
    if (!select || select.disabled) return;
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setValue(select.value);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const selectedLabel = items.find(item => item.value === value)?.label || value || 'SELECT PROFILE';
  const focusAt = (index: number) => {
    if (!items.length) return;
    let next = (index + items.length) % items.length;
    for (let i = 0; i < items.length && items[next]?.disabled; i++) next = (next + 1) % items.length;
    optionRefs.current[next]?.focus();
  };
  return <div className={`glass-select ${className}${open ? ' is-open' : ''}`} ref={root}>
    {nativeChildren}
    <button id={`${selectId}-glass-trigger`} className="glass-select__trigger" type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`${caption}: ${selectedLabel}`}
      onClick={() => setOpen(previous => !previous)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          requestAnimationFrame(() => focusAt(items.findIndex(item => item.value === value) + (event.key === 'ArrowDown' ? 1 : -1)));
        }
      }}>
      <span className="glass-select__value">{selectedLabel}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
    </button>
    {open && !disabled && createPortal(
      <div id={listId} className="glass-select__menu" popover={portalTarget ? "manual" : undefined} role="listbox" aria-label={caption}
        style={{ position: 'fixed', margin: 0, inset: 'auto', top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
        <div className="glass-select__caption">{caption.toUpperCase()}</div>
        {items.map((item, index) => <button key={`${item.value}-${index}`} ref={node => { optionRefs.current[index] = node; }}
          className={`glass-select__option${item.value === value ? ' is-selected' : ''}`} type="button" role="option" aria-selected={item.value === value}
          disabled={item.disabled} onClick={() => choose(item.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusAt(index + (event.key === 'ArrowDown' ? 1 : -1)); }
            if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
            if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1); }
          }}>
          <span>{item.label}</span><span className="glass-select__selected-mark" aria-hidden="true">{item.value === value ? '●' : ''}</span>
        </button>)}
      </div>, portalTarget ?? document.body)
    }
  </div>;
}
