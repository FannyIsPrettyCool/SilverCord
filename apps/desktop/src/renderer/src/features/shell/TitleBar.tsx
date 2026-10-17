import { useTranslation } from 'react-i18next';
import mark from '../../assets/mark.svg';
import { desktop } from '../../desktop.ts';
import styles from './title-bar.module.css';

/** Draggable title strip; double-click maximizes like a native title bar. */
export function TitleBar() {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mirrors the native title bar's double-click; keyboard users have the OS maximize shortcut
    <header className={styles['bar']} onDoubleClick={() => void desktop().window.toggleMaximize()}>
      <img className={styles['mark']} src={mark} alt="" />
      <span className={styles['name']}>{t('brand')}</span>
    </header>
  );
}
