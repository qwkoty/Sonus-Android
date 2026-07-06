import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,6,8,0.92)', color: '#ff9fa6', padding: 24, textAlign: 'center', zIndex: 9999
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>页面渲染出错</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {this.state.error?.message || '未知错误'}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 18px', borderRadius: 12, border: 'none',
                background: 'var(--accent-dynamic)', color: '#050608', fontWeight: 700, cursor: 'pointer'
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
