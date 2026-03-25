export function renderDiscover(root) {
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">发现</div>
      <div style="min-width:44px"></div>
    </div>
    <div style="margin:8px 0">
      <div class="settings-group">
        <div class="discover-item" id="d-moments">
          <div class="discover-icon" style="background:#07C160">🌐</div>
          <span style="flex:1;font-size:16px">朋友圈</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
      </div>
      <div class="settings-group" style="margin:8px 0">
        <div class="discover-item">
          <div class="discover-icon" style="background:#1485EE">🔍</div>
          <span style="flex:1;font-size:16px">搜一搜</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
        <div class="discover-item">
          <div class="discover-icon" style="background:#FA7D3C">📰</div>
          <span style="flex:1;font-size:16px">看一看</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
      </div>
      <div class="settings-group" style="margin:8px 0">
        <div class="discover-item">
          <div class="discover-icon" style="background:#9B59B6">🎮</div>
          <span style="flex:1;font-size:16px">游戏</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
        <div class="discover-item">
          <div class="discover-icon" style="background:#E74C3C">📍</div>
          <span style="flex:1;font-size:16px">附近的人</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
      </div>
      <div class="settings-group">
        <div class="discover-item">
          <div class="discover-icon" style="background:#F1C40F">🛍</div>
          <span style="flex:1;font-size:16px">购物</span>
          <span style="color:var(--text-muted);font-size:18px">›</span>
        </div>
      </div>
    </div>
  `;
}
