import React from 'react';
import clsx from 'clsx';
import colorHash from '@/utils/colorHash';
import { GetReadablePair } from '@/utils';
import styles from './index.module.css';

interface AvatarProps {
  url?: string;
  name?: string;
}

const Avatar: React.FC<AvatarProps> = (props) => {
  const { url, name } = props;
  // 哈希底色明度固定 L=0.6，白字对比度均值只有 2.80:1，按实际对比度反选字色
  const readable = GetReadablePair(colorHash.hex(name || 'ff'));
  return (
    <div
      className={clsx(styles.content)}
      style={{
        backgroundColor: readable.background,
        color: readable.color,
      }}
    >
      {url ? <img /> : <span>{name?.slice(0, 1)}</span>}
    </div>
  );
};

export default Avatar;
