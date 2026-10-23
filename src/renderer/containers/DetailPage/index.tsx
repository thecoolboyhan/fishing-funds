import { Outlet, useLocation } from 'react-router-dom';

import { useShareStoreState, useMappingLocalToSystemSetting } from '@/utils/hooks';
import styles from './index.module.css';

function GlobalTask() {
  useMappingLocalToSystemSetting();
  useShareStoreState();
  return null;
}

const DetailPage = () => {
  const location = useLocation();

  return (
    <div className={styles.content}>
      <Outlet />
      <GlobalTask />
    </div>
  );
};

export default DetailPage;
