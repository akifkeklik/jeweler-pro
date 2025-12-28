import Vue from 'vue';
import Vuetify from 'vuetify/lib/framework';

Vue.use(Vuetify);

const themes = {
	light: {
		primary: '#3F51B5', // indigo
		secondary: '#FFC107', // amber
		accent: '#82B1FF',
		info: '#2196F3',
		success: '#4CAF50',
		warning: '#FB8C00',
		error: '#FF5252',
		background: '#FFFFFF',
	},
	dark: {
		primary: '#8C9EFF',
		secondary: '#FFD54F',
		accent: '#448AFF',
		info: '#64B5F6',
		success: '#81C784',
		warning: '#FFB74D',
		error: '#EF5350',
		background: '#121212',
	}
};

const isDark = (() => {
	try {
		const saved = localStorage.getItem('themeDark');
		return saved === 'true';
	} catch {
		return false;
	}
})();

export default new Vuetify({
	theme: {
		dark: isDark,
		themes,
		options: { customProperties: true },
	},
});
