import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

gsap.registerPlugin(ScrollTrigger);

// 1. Scene Setup
const canvas = document.querySelector('#webgl-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  alpha: true, // Transparent background
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Set up Environment Map for metallic reflections
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// 2. Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 4);
dirLight1.position.set(5, 5, 5);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x8a2be2, 8); // Stronger purple tint for the metal
dirLight2.position.set(-5, 3, -5);
scene.add(dirLight2);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
hemiLight.position.set(0, 10, 0);
scene.add(hemiLight);

// 3. Load Model
const loader = new GLTFLoader();
let model;
let materials = [];

loader.load(
  './assets/model.glb', // Assumes model is placed here
  (gltf) => {
    model = gltf.scene;
    
    // Center model
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x += (model.position.x - center.x);
    model.position.y += (model.position.y - center.y);
    model.position.z += (model.position.z - center.z);
    
    // Ensure model is a shiny silver and fully opaque
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        // Compute vertex normals to guarantee the surface is perfectly smooth (no facets)
        child.geometry.computeVertexNormals();

        // Force the material properties to be shining silver with softer, wider highlights
        child.material.color.setHex(0xffffff); // White base color
        child.material.metalness = 1.0; // Fully metallic
        child.material.roughness = 0.35; // Increased from 0.15 for softer, silky smooth reflections
        
        child.material.transparent = false;
        child.material.opacity = 1.0;
        child.material.envMapIntensity = 2.0; // Boost reflection intensity
        child.material.needsUpdate = true;
      }
    });

    scene.add(model);
    
    // Initial State (State 1) - Starting larger as requested
    model.scale.set(3.5, 3.5, 3.5);
    model.position.z = -2;
    model.position.y = -2; // Move it down slightly so the text fits nicely
    model.rotation.x = 0.1;
    model.rotation.y = 0;
    
    // Create Scroll Animations once loaded
    setupScrollAnimations();

    // Hide loader overlay
    const loaderOverlay = document.getElementById('loader-overlay');
    if (loaderOverlay) {
      loaderOverlay.style.opacity = '0';
      loaderOverlay.style.visibility = 'hidden';
      setTimeout(() => {
        if (loaderOverlay.parentNode) loaderOverlay.parentNode.removeChild(loaderOverlay);
      }, 800);
    }
  },
  undefined,
  (error) => {
    console.error('An error occurred loading the model:', error);
  }
);

// 4. GSAP ScrollTrigger Animations
function setupScrollAnimations() {
  if (!model) return;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      start: "top top",
      end: "+=2500", // Increased scroll distance to accommodate the new card reveal
      scrub: 1.5, 
      pin: true, // PIN the hero section so the screen freezes while zooming!
    }
  });

  // --- Hero Section Fade --- (starts at 0)
  tl.to('.hero-content', { y: -100, opacity: 0, duration: 1.5 }, 0);
  tl.to('.scroll-indicator', { opacity: 0, duration: 1 }, 0);

  // Fade the 3D model in to full brightness as we start scrolling
  tl.to('#webgl-container', { opacity: 1, duration: 1.5 }, 0);

  // --- The Scroll Action (Zoom Through Hole) --- (starts at 0, takes 6 seconds of timeline)
  tl.to(model.scale, { x: 150, y: 150, z: 150, duration: 6 }, 0);
  
  tl.to(model.position, { 
    z: 15, // Pushed far past the camera to completely hide it after zoom
    y: -80, // Move model significantly further down
    x: -0, // Move model left to bring the hole from the top-right into the center
    duration: 6 
  }, 0); 
  
  tl.to(model.rotation, { x: 0, y: 0, z: 0, duration: 6 }, 0);

  // Hide the model completely after the zoom so it doesn't show in corners
  tl.set(model, { visible: false }, 6); 

  // --- Revealing "See For Yourself" Text (Scrubbed with Zoom) ---
  // Starts small (perfectly centered underneath hero content!)
  gsap.set('.hole-text', { scale: 0.5 });
  
  // Immediately after the hero text hides (at 1.5s), show this text as small and faint
  tl.to('.hole-text', { opacity: 0.3, duration: 1 }, 1.5);

  // Slowly scale it up to full size and full opacity as the 3D zoom finishes (from 2.5s to 6s)
  tl.to('.hole-text', { opacity: 1, scale: 1, duration: 3.5 }, 2.5);

  // --- Move Text to Top & Reveal Cards ---
  // Move the hole-text to the top (starting at 6.5, takes 2 seconds)
  tl.to('.hole-text', { top: "35%", duration: 2 }, 6.5);

  // Set initial state for cards container (so it's hidden before it reveals)
  gsap.set('.cards-container', { opacity: 0, y: 50 });
  
  // Fade in and move up the cards container (starts slightly after text starts moving, at 7, takes 2 seconds)
  tl.to('.cards-container', { opacity: 1, y: 0, pointerEvents: 'auto', duration: 2 }, 7);

  // Optional: Add a pause at the end so it stays on screen a bit before unpinning
  tl.to({}, { duration: 1 }); // empty tween to extend timeline

  // --- Revealing Projects & New Sections ---

  // Default settings for all triggers
  ScrollTrigger.defaults({
    toggleActions: "play none none none",
    refreshPriority: -1
  });

  // 1. PROJECTS SECTION ANIMATIONS
  gsap.fromTo('#projects h2', 
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: '#projects', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.2
    }
  );

  const projectRows = document.querySelectorAll('.project-row');
  projectRows.forEach((row, index) => {
    // Card animation
    gsap.fromTo(row,
      { opacity: 0, y: 60 },
      {
        scrollTrigger: {
          trigger: row,
          start: 'top 75%'
        },
        opacity: 1, y: 0, duration: 1, ease: 'power3.out'
      }
    );

    // Project Text Elements
    const title = row.querySelector('h3');
    const p = row.querySelector('p');
    const link = row.querySelector('.project-link');

    gsap.fromTo(title, { opacity: 0, y: 20 }, {
      scrollTrigger: { trigger: row, start: 'top 75%' },
      opacity: 1, y: 0, duration: 0.5, delay: 0.1
    });
    
    gsap.fromTo(p, { opacity: 0, y: 20 }, {
      scrollTrigger: { trigger: row, start: 'top 75%' },
      opacity: 1, y: 0, duration: 0.6, delay: 0.3
    });

    gsap.fromTo(link, { opacity: 0 }, {
      scrollTrigger: { trigger: row, start: 'top 75%' },
      opacity: 1, duration: 0.4, delay: 0.6
    });
  });

  // 2. CONCEPTS SECTION ANIMATIONS
  gsap.fromTo('#concepts h2', 
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: '#concepts', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
    }
  );

  const conceptCards = document.querySelectorAll('.concept-card');
  if (conceptCards.length > 0) {
    gsap.fromTo(conceptCards,
      { opacity: 0, y: 50, scale: 0.95 },
      {
        scrollTrigger: { trigger: '.concepts-grid', start: 'top 75%' },
        opacity: 1, y: 0, scale: 1, duration: 0.9, ease: 'power3.out', stagger: 0.15
      }
    );
    
    conceptCards.forEach((card, index) => {
      const h4 = card.querySelector('h4');
      gsap.fromTo(h4,
        { opacity: 0 },
        {
          scrollTrigger: { trigger: '.concepts-grid', start: 'top 75%' },
          opacity: 1, duration: 0.5, delay: index * 0.15 + 0.2
        }
      );
    });

    gsap.fromTo('.concepts-action button',
      { opacity: 0, y: 20 },
      {
        scrollTrigger: { trigger: '.concepts-grid', start: 'top 75%' },
        opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', delay: (conceptCards.length * 0.15) + 0.4
      }
    );
  }

  // 3. MEET THE PERSON SECTION ANIMATIONS
  gsap.fromTo('.about-title-top',
    { opacity: 0, y: 50 },
    {
      scrollTrigger: { trigger: '.about-header', start: 'top 65%' },
      opacity: 1, y: 0, duration: 0.9, ease: 'power3.out'
    }
  );

  gsap.fromTo('.about-title-bottom',
    { opacity: 0, y: 50 },
    {
      scrollTrigger: { trigger: '.about-header', start: 'top 65%' },
      opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 0.2
    }
  );

  gsap.fromTo('.about-image',
    { opacity: 0, scale: 0.95, x: -30 },
    {
      scrollTrigger: { trigger: '.about-image', start: 'top 70%' },
      opacity: 1, scale: 1, x: 0, duration: 1, ease: 'power3.out'
    }
  );

  gsap.fromTo('.about-content h3',
    { opacity: 0, y: 30 },
    {
      scrollTrigger: { trigger: '.about-image', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.6, delay: 0.3
    }
  );

  const aboutParagraphs = document.querySelectorAll('.about-content p');
  gsap.fromTo(aboutParagraphs,
    { opacity: 0, y: 20 },
    {
      scrollTrigger: { trigger: '.about-image', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.7, stagger: 0.15, delay: 0.5
    }
  );

  gsap.fromTo('.about-content .project-link',
    { opacity: 0, y: 10 },
    {
      scrollTrigger: { trigger: '.about-image', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.5, delay: 0.5 + (aboutParagraphs.length * 0.15) + 0.3
    }
  );

  // 4. PRICING CALCULATOR SECTION ANIMATIONS
  gsap.fromTo('#pricing h2',
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: '#pricing', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
    }
  );

  gsap.fromTo('#pricing .section-subtext',
    { opacity: 0, y: 20 },
    {
      scrollTrigger: { trigger: '#pricing', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.6, delay: 0.2
    }
  );

  const featureItems = document.querySelectorAll('.feature-list li');
  gsap.fromTo(featureItems,
    { opacity: 0, x: -20 },
    {
      scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
      opacity: 1, x: 0, duration: 0.5, stagger: 0.1, delay: 0.2
    }
  );

  const configItemFirst = document.querySelector('.config-item:not(.toggle-item)');
  if (configItemFirst) {
    gsap.fromTo(configItemFirst,
      { opacity: 0, x: 30 },
      {
        scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
        opacity: 1, x: 0, duration: 0.6, delay: 0.3
      }
    );
  }

  const calcToggleItems = document.querySelectorAll('.toggle-item');
  gsap.fromTo(calcToggleItems,
    { opacity: 0, x: 30 },
    {
      scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
      opacity: 1, x: 0, duration: 0.5, stagger: 0.12, delay: 0.3
    }
  );

  gsap.fromTo('.price-total',
    { opacity: 0, scale: 0.8, y: 20 },
    {
      scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
      opacity: 1, scale: 1, y: 0, duration: 0.8, ease: 'back.out(1.2)', delay: 0.3 + (calcToggleItems.length * 0.12) + 0.4
    }
  );

  gsap.fromTo('.pricing-footer .btn',
    { opacity: 0, y: 20 },
    {
      scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
      opacity: 1, y: 0, duration: 0.6, delay: 0.3 + (calcToggleItems.length * 0.12) + 0.4 + 0.2
    }
  );

  gsap.fromTo('.disclaimer',
    { opacity: 0 },
    {
      scrollTrigger: { trigger: '.pricing-grid', start: 'top 65%' },
      opacity: 1, duration: 0.4, delay: 0.3 + (calcToggleItems.length * 0.12) + 0.4 + 0.2 + 0.1
    }
  );

  // 5. CONTACT FORM SECTION ANIMATIONS
  gsap.fromTo('#contact h2',
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: '#contact', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
    }
  );

  gsap.fromTo('#contact .contact-subtext',
    { opacity: 0, y: 20 },
    {
      scrollTrigger: { trigger: '#contact', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.6, delay: 0.2
    }
  );

  const contactLinksAnim = document.querySelectorAll('.contact-detail-link');
  gsap.fromTo(contactLinksAnim,
    { opacity: 0, x: -30 },
    {
      scrollTrigger: { trigger: '.contact-grid', start: 'top 65%' },
      opacity: 1, x: 0, duration: 0.6, stagger: 0.1
    }
  );

  const contactInputGroups = document.querySelectorAll('.input-group');
  gsap.fromTo(contactInputGroups,
    { opacity: 0, y: 20 },
    {
      scrollTrigger: { trigger: '.contact-form-container', start: 'top 65%' },
      opacity: 1, y: 0, duration: 0.5, stagger: 0.1, delay: 0.2
    }
  );

  gsap.fromTo('.turnstile-placeholder',
    { opacity: 0 },
    {
      scrollTrigger: { trigger: '.contact-form-container', start: 'top 65%' },
      opacity: 1, duration: 0.4, delay: 0.2 + (contactInputGroups.length * 0.1) + 0.3
    }
  );

  gsap.fromTo('.contact-form .btn',
    { opacity: 0, y: 20, scale: 0.95 },
    {
      scrollTrigger: { trigger: '.contact-form-container', start: 'top 65%' },
      opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out', delay: 0.2 + (contactInputGroups.length * 0.1) + 0.3 + 0.2
    }
  );

  // 6. FAQ SECTION ANIMATIONS
  gsap.fromTo('#faq h2',
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: '#faq', start: 'top 70%' },
      opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
    }
  );

  const faqItemsAnim = document.querySelectorAll('.faq-item');
  gsap.fromTo(faqItemsAnim,
    { opacity: 0, y: 30 },
    {
      scrollTrigger: { trigger: '.faq-list', start: 'top 75%' },
      opacity: 1, y: 0, duration: 0.6, stagger: 0.15
    }
  );

  // 7. FOOTER ANIMATIONS
  const footerColsAnim = document.querySelectorAll('.footer-col');
  gsap.fromTo(footerColsAnim,
    { opacity: 0, y: 40 },
    {
      scrollTrigger: { trigger: 'footer', start: 'top 80%' },
      opacity: 1, y: 0, duration: 0.7, stagger: 0.2
    }
  );

  footerColsAnim.forEach((col, index) => {
    const links = col.querySelectorAll('a');
    gsap.fromTo(links,
      { opacity: 0, y: 10 },
      {
        scrollTrigger: { trigger: 'footer', start: 'top 80%' },
        opacity: 1, y: 0, duration: 0.4, stagger: 0.05, delay: 0.1 + (index * 0.2)
      }
    );
  });

  gsap.fromTo('.footer-bottom',
    { opacity: 0 },
    {
      scrollTrigger: { trigger: 'footer', start: 'top 80%' },
      opacity: 1, duration: 0.5, delay: 0.3 + (footerColsAnim.length * 0.2)
    }
  );

  gsap.fromTo('.scroll-to-top',
    { opacity: 0, scale: 0.5 },
    {
      scrollTrigger: { trigger: 'footer', start: 'top 80%' },
      opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.5)', delay: 0.5
    }
  );
}

// 5. Animation Loop
const clock = new THREE.Clock();

function tick() {
  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
}

tick();

// 6. Resize Handler
window.addEventListener('resize', () => {
  // Update camera
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Refresh ScrollTrigger on resize
  ScrollTrigger.refresh();
});

// 7. Interactive Logic for New Sections

document.addEventListener('DOMContentLoaded', () => {
  // --- Pricing Calculator ---
  const basePrice = 1290;
  const pricePerPage = 100;
  
  const pageSlider = document.getElementById('page-slider');
  const pageCountDisplay = document.getElementById('page-count-display');
  const totalPriceDisplay = document.getElementById('total-price');
  const toggleItems = document.querySelectorAll('.toggle-item');
  
  function calculateTotal() {
    let total = basePrice;
    
    // Add page costs (first page is included in base)
    const pages = parseInt(pageSlider.value);
    if (pages > 1) {
      total += (pages - 1) * pricePerPage;
    }
    
    // Add toggle costs
    toggleItems.forEach(item => {
      if (item.classList.contains('active')) {
        total += parseInt(item.dataset.price);
      }
    });
    
    // Format and display
    totalPriceDisplay.textContent = `€${total.toLocaleString()}`;
  }
  
  if (pageSlider) {
    pageSlider.addEventListener('input', (e) => {
      pageCountDisplay.textContent = e.target.value;
      calculateTotal();
    });
    
    toggleItems.forEach(item => {
      item.addEventListener('click', () => {
        item.classList.toggle('active');
        calculateTotal();
      });
    });
    
    // Initialize price
    calculateTotal();
  }

  // --- FAQ Accordion ---
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      // Toggle current item
      const isActive = item.classList.contains('active');
      
      // Close all others
      faqItems.forEach(faq => faq.classList.remove('active'));
      
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // --- Scroll to Top ---
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }
});
