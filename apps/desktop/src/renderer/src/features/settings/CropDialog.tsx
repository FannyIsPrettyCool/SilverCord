import type { Crop } from '@silvercord/protocol';
import { Button, Glass } from '@silvercord/ui';
import { type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './crop.module.css';

const FRAME_WIDTH = 360;
const MAX_ZOOM = 4;

interface View {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

/** Keeps the scaled image covering the frame on both axes. */
export function clampView(
  view: View,
  natural: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): View {
  const base = Math.max(frame.width / natural.width, frame.height / natural.height);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const scale = base * zoom;
  const minX = frame.width - natural.width * scale;
  const minY = frame.height - natural.height * scale;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, view.x)),
    y: Math.min(0, Math.max(minY, view.y)),
  };
}

/** The visible frame expressed in source pixels, as the server applies it to every frame. */
export function cropOf(
  view: View,
  natural: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): Crop {
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height) * view.zoom;
  const width = Math.max(16, Math.min(natural.width, Math.round(frame.width / scale)));
  const height = Math.max(16, Math.min(natural.height, Math.round(frame.height / scale)));
  return {
    x: Math.min(natural.width - width, Math.max(0, Math.round(-view.x / scale))),
    y: Math.min(natural.height - height, Math.max(0, Math.round(-view.y / scale))),
    width,
    height,
  };
}

/**
 * Pan (drag or arrow keys) and zoom (slider, wheel or +/-) inside a fixed frame; animated
 * images keep playing and the server crops every frame identically.
 */
export function CropDialog({
  file,
  aspect,
  round,
  onCancel,
  onApply,
}: {
  readonly file: File;
  readonly aspect: number;
  readonly round: boolean;
  readonly onCancel: () => void;
  readonly onApply: (crop: Crop) => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const frame = { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH / aspect) };

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const update = (next: View) => {
    if (natural) setView(clampView(next, natural, frame));
  };
  const zoomTo = (zoom: number) => {
    // Zoom around the frame centre so the subject stays put.
    const ratio = Math.min(MAX_ZOOM, Math.max(1, zoom)) / view.zoom;
    const cx = frame.width / 2;
    const cy = frame.height / 2;
    update({ zoom, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio });
  };
  const scale = natural
    ? Math.max(frame.width / natural.width, frame.height / natural.height) * view.zoom
    : 1;

  return (
    <dialog
      ref={dialog}
      className={styles['dialog']}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <Glass level={3} className={styles['panel']}>
        <h2 id={titleId} className={styles['title']}>
          {t('settings.crop.title')}
        </h2>
        <div
          className={styles['frame']}
          data-round={round || undefined}
          style={{ width: frame.width, height: frame.height }}
          role="application"
          aria-label={t('settings.crop.title')}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame is the keyboard pan target.
          tabIndex={0}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 10;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [step, 0],
              ArrowRight: [-step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              update({ ...view, x: view.x + move[0], y: view.y + move[1] });
            } else if (event.key === '+' || event.key === '=') zoomTo(view.zoom + 0.1);
            else if (event.key === '-') zoomTo(view.zoom - 0.1);
          }}
          onWheel={(event) => zoomTo(view.zoom - event.deltaY / 800)}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, view };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            update({
              ...start.view,
              x: start.view.x + event.clientX - start.x,
              y: start.view.y + event.clientY - start.y,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              className={styles['image']}
              style={
                natural
                  ? {
                      width: natural.width * scale,
                      height: natural.height * scale,
                      transform: `translate(${view.x}px, ${view.y}px)`,
                    }
                  : { visibility: 'hidden' }
              }
              onLoad={(event) => {
                const size = {
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                };
                setNatural(size);
                // Start centred.
                const base = Math.max(frame.width / size.width, frame.height / size.height);
                setView(
                  clampView(
                    {
                      zoom: 1,
                      x: (frame.width - size.width * base) / 2,
                      y: (frame.height - size.height * base) / 2,
                    },
                    size,
                    frame,
                  ),
                );
              }}
            />
          ) : null}
        </div>
        <label className={styles['zoom']}>
          <span>{t('settings.crop.zoom')}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(event) => zoomTo(Number(event.target.value))}
          />
        </label>
        <div className={styles['actions']}>
          <Button variant="quiet" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!natural}
            onClick={() => {
              if (natural) onApply(cropOf(view, natural, frame));
            }}
          >
            {t('settings.crop.apply')}
          </Button>
        </div>
      </Glass>
    </dialog>
  );
}
