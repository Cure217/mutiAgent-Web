import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard'
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/dashboard/DashboardView.vue'),
      meta: { title: '架构师总控台' }
    },
    {
      path: '/instances',
      name: 'instances',
      component: () => import('@/views/instances/InstanceListView.vue'),
      meta: { title: '应用实例管理' }
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: () => import('@/views/sessions/SessionListView.vue'),
      meta: { title: '会话管理' }
    },
    {
      path: '/sessions/:id',
      name: 'session-detail',
      component: () => import('@/views/sessions/SessionDetailView.vue'),
      meta: { title: '会话详情' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/settings/SettingsView.vue'),
      meta: { title: '系统设置' }
    }
  ]
});

export default router;
