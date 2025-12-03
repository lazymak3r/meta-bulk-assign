(() => {
	document.addEventListener('DOMContentLoaded', () => {
		window.addEventListener('scroll', () => {
			const scrollButton = document.getElementById('back-to-top');
			if (this.scrollY > 100) {
				scrollButton.classList.add('active');
			} else {
				scrollButton.classList.remove('active');
			}
		});
	});
})();
