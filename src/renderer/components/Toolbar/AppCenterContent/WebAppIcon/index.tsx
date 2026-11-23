import React from 'react';
import { useBoolean } from 'ahooks';
import colorHash from '@/utils/colorHash';
import { GetReadablePair } from '@/utils';
import * as Enums from '@/utils/enums';
import styles from './index.module.css';

interface WebAppIconProps {
  title: string;
  iconType?: Enums.WebIconType;
  favicon?: string;
  svg?: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

const WebAppIcon: React.FC<WebAppIconProps> = (props) => {
  const { iconType, title, favicon } = props;
  const [success, { setFalse }] = useBoolean(true);

  const icon = (() => {
    // 底色可能来自哈希（明度固定 L=0.6）或用户自选，固定白字会掉到 1.6:1
    const readable = GetReadablePair(props.color || colorHash.hex(title));

    switch (iconType) {
      case Enums.WebIconType.First:
        return (
          <div
            className={styles.app}
            style={{
              background: readable.background,
              color: readable.color,
            }}
            onClick={props.onClick}
          >
            <i>{title.slice(0, 1)}</i>
          </div>
        );
      case Enums.WebIconType.Favicon:
        return success ? (
          <img src={favicon} onClick={props.onClick} onError={setFalse} />
        ) : (
          <div
            className={styles.app}
            style={{
              background: 'var(--cancel-color)',
            }}
            onClick={props.onClick}
          ></div>
        );
      case Enums.WebIconType.Svg:
        return (
          <div
            className={styles.app}
            style={{
              background: readable.background,
              color: readable.color,
            }}
            onClick={props.onClick}
          >
            {props.svg}
          </div>
        );
    }
  })();

  return (
    <div className={styles.content}>
      {icon}
      <div className={styles.name}>{title}</div>
    </div>
  );
};

export default WebAppIcon;
