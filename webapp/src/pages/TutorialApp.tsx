import { useEffect, useRef } from 'react';
import { TutorialHeader } from '../components/TutorialHeader';
import { TutorialContent } from '../components/TutorialContent';
import { TutorialFooter } from '../components/TutorialFooter';

/** The guide's motion is progressive enhancement: content remains visible without JS observers. */
export function TutorialApp() {
  const progressRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(
      '.hwg-chapter, .guide-lab, .guide-digital-hero, .guide-workflows__intro, .guide-chapter-nav, .tutorial-stage'
    ));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let revealObserver: IntersectionObserver | undefined;
    if (!reduceMotion && 'IntersectionObserver' in window) {
      // Visible content is never hidden; only approaching sections receive a one-time reveal.
      revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('guide-reveal--pending');
          entry.target.classList.add('guide-reveal--visible');
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -30px 0px', threshold: 0.04 });
      targets.forEach(target => {
        target.classList.add('guide-reveal');
        if (target.getBoundingClientRect().top > window.innerHeight * 0.9) {
          target.classList.add('guide-reveal--pending');
        }
        revealObserver?.observe(target);
      });
    }
    // Play explanation sequences only once as they first enter the viewport.
    // The content is fully visible if observers or animations are unavailable.
    let sequenceObserver: IntersectionObserver | undefined;
    if (!reduceMotion && 'IntersectionObserver' in window) {
      const sequences = document.querySelectorAll<HTMLElement>(
        '.concept-map, .hwg-hero-side, .guide-workflow__steps, .interface-map'
      );
      sequenceObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('guide-sequence-played');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.22 });
      sequences.forEach(section => sequenceObserver?.observe(section));
    }
    let frame = 0;
    const chapterLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.guide-chapter-nav a[href^="#"]'));
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        if (progressRef.current) progressRef.current.style.width = `${Math.max(0, Math.min(100, window.scrollY / max * 100))}%`;
        let current = '';
        for (const id of ['hardware-guide', 'brick-maker-guide', 'digital-builder-guide']) {
          const section = document.getElementById(id);
          if (section && section.getBoundingClientRect().top < window.innerHeight * 0.34) current = id;
        }
        chapterLinks.forEach(link => {
          const active = link.hash === `#${current}`;
          link.classList.toggle('is-current', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll);
    return () => {
      revealObserver?.disconnect();
      sequenceObserver?.disconnect();
      targets.forEach(target => target.classList.remove('guide-reveal','guide-reveal--pending','guide-reveal--visible'));
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="tutorial-page" id="top">
      <div className="guide-reading-progress" aria-hidden="true"><span className="guide-reading-progress__fill" ref={progressRef}/></div>
      <TutorialHeader />
      <TutorialContent />
      <TutorialFooter />
    </div>
  );
}
