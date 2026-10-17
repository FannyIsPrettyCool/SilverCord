import styles from './spinner.module.css';

/** Decorative progress ring; the owning control carries `aria-busy`. */
export function Spinner({ size = 20 }: { readonly size?: number }) {
  return (
    <span className={styles['spinner']} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
