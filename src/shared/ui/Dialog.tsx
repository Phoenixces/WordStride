import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({ title, children, onClose, className }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={className} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-title"
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog">Close <span aria-hidden="true">×</span></button></div>
    {children}
  </dialog>;
}
