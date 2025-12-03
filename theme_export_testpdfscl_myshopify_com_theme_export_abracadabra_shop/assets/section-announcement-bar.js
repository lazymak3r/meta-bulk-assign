document.addEventListener('DOMContentLoaded', function() {
  const announcementBar = document.querySelector('.announcement-bar');
  const autoPlay = announcementBar?.dataset.autoplay;

  if (autoPlay && parseInt(autoPlay) > 0) {
    const slider = announcementBar.querySelector('.announcement-bar .container');
    const items = slider.querySelectorAll('.announcement-item');

    if (items.length > 1) {
      slider.style.animationDuration = `${parseInt(autoPlay)}s`;

      announcementBar.addEventListener('mouseenter', () => {
        slider.style.animationPlayState = 'paused';
      });

      announcementBar.addEventListener('mouseleave', () => {
        slider.style.animationPlayState = 'running';
      });
    }
  }
});
