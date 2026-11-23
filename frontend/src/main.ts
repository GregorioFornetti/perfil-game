import { createApp } from 'vue';
import { io } from 'socket.io-client';
import App from './App.vue';
import { createAppI18n, LOCALE_KEY, pickLocale } from './i18n';
import { createStore } from './store';
import './style.css';

const i18n = createAppI18n(pickLocale(localStorage.getItem(LOCALE_KEY), navigator.language));

// Same address as the page: in production the game server serves the page itself,
// and while developing Vite passes the connection on to it (see vite.config.ts).
const socket = io({ auth: (cb) => cb({ locale: i18n.global.locale.value }) });
const store = createStore(socket, localStorage, () => i18n.global.locale.value);

createApp(App, { store }).use(i18n).mount('#app');
