import type { PublicUser } from '@silvercord/protocol';
import { Button, Glass, useSpring } from '@silvercord/ui';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOpenChannel } from '../../api/chat.ts';
import { usePresence } from '../../api/presence.ts';
import { useProfile, useSummary } from '../../api/profiles.ts';
import { useSendFriendRequest } from '../../api/social.ts';
import { useSession } from '../../session/session-store.ts';
import { ProfileCard } from './ProfileCard.tsx';
import styles from './popout.module.css';
import { cardFrom, useProfileView } from './profile-view.ts';

const WIDTH = 340;
const GAP = 12;
const MARGIN = 12;

/** Beside the trigger (right, else left), clamped inside the window. */
function place(anchor: DOMRect, height: number) {
  const right = anchor.right + GAP;
  const left =
    right + WIDTH + MARGIN <= window.innerWidth
      ? right
      : Math.max(MARGIN, anchor.left - GAP - WIDTH);
  const top = Math.min(
    Math.max(MARGIN, anchor.top - 24),
    Math.max(MARGIN, window.innerHeight - height - MARGIN),
  );
  return { left, top, origin: left >= anchor.right ? 'left top' : 'right top' };
}

function PopoutContent({
  user,
  guildId,
  close,
}: {
  readonly user: PublicUser;
  readonly guildId: string | undefined;
  readonly close: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selfId = useSession((s) => s.user?.id ?? null);
  const profile = useProfile(user.id, guildId);
  const summary = useSummary(user.id, guildId);
  const statusOf = usePresence([user.id]);
  const openChannel = useOpenChannel();
  const addFriend = useSendFriendRequest();
  const openFull = useProfileView((s) => s.open);
  const card = cardFrom(user, profile.data, summary.data);
  const relationship = profile.data?.relationship;
  const self = user.id === selfId;
  return (
    <ProfileCard card={card} presence={statusOf(user.id)}>
      {profile.data?.note ? <p className={styles['note']}>{profile.data.note}</p> : null}
      <div className={styles['actions']}>
        {self ? (
          <Button
            onClick={async () => {
              close();
              await navigate({ to: '/app/settings/$section', params: { section: 'profile' } });
            }}
          >
            {t('profile.edit')}
          </Button>
        ) : null}
        {!self && relationship === 'friends' ? (
          <Button
            loading={openChannel.isPending}
            onClick={async () => {
              const channel = await openChannel.mutateAsync({ recipientId: user.id });
              close();
              await navigate({
                to: '/app/channels/$channelId',
                params: { channelId: channel.id },
              });
            }}
          >
            {t('profile.message')}
          </Button>
        ) : null}
        {!self && relationship === 'none' ? (
          <Button
            variant="quiet"
            loading={addFriend.isPending}
            disabled={addFriend.isSuccess}
            onClick={() => addFriend.mutate(user.username)}
          >
            {addFriend.isSuccess ? t('profile.requestSent') : t('profile.addFriend')}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          onClick={() => {
            close();
            openFull(user.id, guildId);
          }}
        >
          {t('profile.viewFull')}
        </Button>
      </div>
    </ProfileCard>
  );
}

/**
 * Wraps an avatar or name: activating it opens the profile popout beside it. The panel is
 * portalled so scrolling lists and clipped sidebars never cut it off.
 */
export function ProfileTrigger({
  user,
  guildId,
  className,
  label,
  children,
}: {
  readonly user: PublicUser;
  readonly guildId?: string | undefined;
  readonly className?: string | undefined;
  readonly label?: string | undefined;
  readonly children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof place> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const spring = useSpring('surface');
  const close = useCallback(() => {
    setAnchor(null);
    trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!anchor) return;
    setPosition(place(anchor, panel.current?.offsetHeight ?? 420));
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setAnchor(null);
    };
    const onResize = () => setAnchor(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, close]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className ?? styles['trigger']}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-controls={anchor ? id : undefined}
        aria-label={label}
        onClick={() =>
          setAnchor((current) =>
            current ? null : (trigger.current?.getBoundingClientRect() ?? null),
          )
        }
      >
        {children}
      </button>
      {createPortal(
        <AnimatePresence>
          {anchor ? (
            <motion.div
              ref={panel}
              id={id}
              role="dialog"
              aria-modal="false"
              tabIndex={-1}
              className={styles['panel']}
              style={{
                left: position?.left ?? -9999,
                top: position?.top ?? 0,
                transformOrigin: position?.origin ?? 'left top',
              }}
              initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring}
            >
              <Glass level={3} className={styles['glass']}>
                <PopoutContent user={user} guildId={guildId} close={close} />
              </Glass>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
