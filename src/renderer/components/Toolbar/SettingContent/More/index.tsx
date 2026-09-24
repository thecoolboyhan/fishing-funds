import React from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { RiLink, RiWindowLine, RiGroupLine, RiTerminalBoxLine } from 'react-icons/ri';
import StandCard from '@/components/Card/StandCard';
import PayCarousel from '@/components/PayCarousel';
import Guide from '@/components/Guide';
import * as Utils from '@/utils';
import styles from '../index.module.css';

interface MoreProps {}

const { shell } = window.contextModules.electron;
const process = window.contextModules.process;

const linksGroup = Utils.Group(
  [
    {
      url: 'https://github.com/thecoolboyhan',
      name: '联系作者',
    },
    {
      url: 'https://thecoolboyhan.github.io/p/fishing-funds/',
      name: '官方网站',
    },
    {
      url: 'https://github.com/thecoolboyhan/fishing-funds/releases',
      name: '更新日志',
    },
    {
      url: 'https://github.com/thecoolboyhan/fishing-funds',
      name: 'Github',
    },
    {
      url: 'https://github.com/thecoolboyhan/fishing-funds/issues',
      name: 'BUG反馈',
    },
    {
      url: 'https://github.com/thecoolboyhan/fishing-funds/issues',
      name: '提出建议',
    },
  ],
  3
);

const recordSiteGroup = Utils.Group(
  [
    {
      url: 'https://github.com/thecoolboyhan/fishing-funds/releases',
      name: 'GitHub Releases',
    },
    {
      url: 'https://thecoolboyhan.github.io/p/fishing-funds/',
      name: '官方网站',
    },
  ],
  3
);

const More: React.FC<MoreProps> = () => {
  function onNavigate(url: string) {
    shell.openExternal(url);
  }

  return (
    <div className={styles.content}>
      <PayCarousel />
      <StandCard
        icon={<RiLink />}
        title="关于 Fishing Funds"
        extra={
          <div className={styles.guide}>
            <Guide list={[{ name: '☕️', text: 'buy me a coffee :)' }]} />
          </div>
        }
      >
        <div className={clsx('card-body')}>
          <div className={clsx(styles.describe)}>
            {
              'Fishing Funds是一款个人开发小软件，开源后深受大家的喜爱，接受了大量宝贵的改进建议，感谢大家的反馈，作者利用空闲时间开发不易，您的支持可以给本项目的开发和完善提供巨大的动力，感谢对本软件的喜爱和认可:)'
            }
          </div>
          {linksGroup.map((links, index) => (
            <div key={index} className={styles.link}>
              {links.map((link) => (
                <React.Fragment key={link.name}>
                  <a onClick={() => onNavigate(link.url)}>{link.name}</a>
                  <i />
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </StandCard>
      <StandCard icon={<RiGroupLine />} title="讨论交流">
        <div className={clsx(styles.group, 'card-body')}>
          <section>
            <label>issues：</label>
            <a onClick={() => onNavigate('https://github.com/thecoolboyhan/fishing-funds/issues')}>问题反馈</a>
          </section>
        </div>
      </StandCard>
      <StandCard icon={<RiWindowLine />} title="收录网站">
        <div className={clsx('card-body')}>
          {recordSiteGroup.map((links, index) => (
            <div key={index} className={styles.link}>
              {links.map((link) => (
                <React.Fragment key={link.name}>
                  <a onClick={() => onNavigate(link.url)}>{link.name}</a>
                  <i />
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </StandCard>
      <StandCard icon={<RiTerminalBoxLine />} title="构建信息">
        <div className={clsx(styles.buildGroup, 'card-body')}>
          <section>
            <label>Electron：</label>
            <div>{process.electron}</div>
          </section>
          <section>
            <label>Node.js：</label>
            <div>{process.node}</div>
          </section>
          <section>
            <label>Chromium：</label>
            <div>{process.chrome}</div>
          </section>
          <section>
            <label>V8：</label>
            <div>{process.v8}</div>
          </section>
          <section>
            <label>OS：</label>
            <div>
              {process.platform} {process.arch}
            </div>
          </section>
          <section>
            <label>Sandboxed：</label>
            <div>{String(process.sandboxed)}</div>
          </section>
          <section>
            <label>构建日期：</label>
            <div>{dayjs(process.buildDate).format('YYYYMMDDHHmmss')}</div>
          </section>
        </div>
      </StandCard>
    </div>
  );
};

export default More;
