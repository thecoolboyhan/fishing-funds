import React from 'react';

/**
 * 全局错误边界（2026-11-19 新增）。
 * 原应用没有任何错误边界：任一渲染期异常（例如某条行情缺字段导致 `undefined.xxx`）
 * 都会让 React 卸载整棵树，表现为**纯白窗口且无提示**，只能强杀重开。
 * 这里兜住渲染异常，给出可恢复的错误页 —— 「重试」重挂子树，「重新加载」重启渲染进程。
 */
interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 保留堆栈便于用户反馈时定位；不弹窗打扰
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private onRetry = () => this.setState({ error: null });

  private onReload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100vh',
          padding: 24,
          boxSizing: 'border-box',
          color: 'var(--main-text-color, #333)',
          backgroundColor: 'var(--inner-color, #f5f5f5)',
          fontSize: 'calc(var(--base-font-size, 14px) * 0.9)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 'calc(var(--base-font-size, 14px) * 1.2)', fontWeight: 600 }}>页面出了点问题</div>
        <div style={{ color: 'var(--secondary-main-text-color, #888)', maxWidth: 420, lineHeight: 1.6 }}>
          {error.message || '渲染时发生未知错误，行情数据不受影响。'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={this.onRetry}
            style={{
              padding: '4px 14px',
              border: '1px solid var(--primary-color, #1677ff)',
              borderRadius: 'var(--base-radius, 8px)',
              color: 'var(--primary-color, #1677ff)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          <button
            onClick={this.onReload}
            style={{
              padding: '4px 14px',
              border: '1px solid var(--border-color, #d9d9d9)',
              borderRadius: 'var(--base-radius, 8px)',
              color: 'var(--main-text-color, #333)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
