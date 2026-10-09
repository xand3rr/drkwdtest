(function () {
  'use strict';

  function initializeNavigation() {
    var toggle = document.querySelector('.menu-toggle');
    var navigation = document.querySelector('.main-nav');
    if (!toggle || !navigation) return;

    var mobileViewport = window.matchMedia('(max-width: 800px)');
    if (!navigation.id) navigation.id = 'primary-navigation';
    toggle.setAttribute('aria-controls', navigation.id);
    toggle.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.add('js-nav');

    function isOpen() {
      return toggle.getAttribute('aria-expanded') === 'true';
    }

    function closeNavigation(restoreFocus) {
      if (!isOpen()) return;
      navigation.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus && mobileViewport.matches) toggle.focus();
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) {
        closeNavigation(true);
      } else {
        navigation.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        closeNavigation(true);
      }
    });

    navigation.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeNavigation(false);
    });

    document.addEventListener('click', function (event) {
      if (isOpen() && !navigation.contains(event.target) && !toggle.contains(event.target)) {
        closeNavigation(false);
      }
    });

    function handleViewportChange() {
      var focusWasInNavigation = navigation.contains(document.activeElement);
      closeNavigation(false);
      if (mobileViewport.matches && focusWasInNavigation) toggle.focus();
    }

    if (mobileViewport.addEventListener) {
      mobileViewport.addEventListener('change', handleViewportChange);
    } else {
      mobileViewport.addListener(handleViewportChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNavigation);
  } else {
    initializeNavigation();
  }
})();
