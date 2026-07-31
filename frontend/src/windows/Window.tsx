import { Rnd } from "react-rnd";
import { useWindowStore, type WindowInstance } from "./windowStore";
import { getApp } from "../apps/registry";
import styles from "./Window.module.css";

export function Window({ win }: { win: WindowInstance }) {
  const { focusWindow, closeWindow, minimizeWindow, toggleMaximize, moveResize } = useWindowStore();
  const app = getApp(win.appId);
  if (!app || win.minimized) return null;

  const Body = app.component;

  return (
    <Rnd
      size={{ width: win.width, height: win.height }}
      position={{ x: win.x, y: win.y }}
      // react-rnd writes `display` as an inline style, which beats anything the
      // .window class sets. The column layout has to be declared here or the
      // window is never a flex container and its content escapes the frame.
      style={{ zIndex: win.zIndex, display: "flex", flexDirection: "column" }}
      minWidth={320}
      minHeight={220}
      bounds="parent"
      dragHandleClassName={styles.titlebar}
      disableDragging={win.maximized}
      enableResizing={!win.maximized}
      onDragStop={(_e, d) => moveResize(win.id, { x: d.x, y: d.y, width: win.width, height: win.height })}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        moveResize(win.id, {
          x: pos.x,
          y: pos.y,
          width: parseInt(ref.style.width, 10),
          height: parseInt(ref.style.height, 10),
        })
      }
      onMouseDown={() => focusWindow(win.id)}
      className={styles.window}
    >
      <div className={styles.titlebar} onDoubleClick={() => toggleMaximize(win.id)}>
        <span className={styles.titleIcon}>{app.icon}</span>
        <span className={styles.titleText}>{win.title}</span>
        <div className={styles.controls}>
          <button className={styles.controlBtn} onClick={() => minimizeWindow(win.id)} aria-label="Minimizar">
            &#8211;
          </button>
          <button className={styles.controlBtn} onClick={() => toggleMaximize(win.id)} aria-label="Maximizar">
            &#9723;
          </button>
          <button className={`${styles.controlBtn} ${styles.closeBtn}`} onClick={() => closeWindow(win.id)} aria-label="Cerrar">
            &#10005;
          </button>
        </div>
      </div>
      <div className={styles.content}>
        <Body {...(win.props ?? {})} windowId={win.id} />
      </div>
    </Rnd>
  );
}
