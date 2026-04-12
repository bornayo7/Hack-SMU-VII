export type TeamMember = {
  name: string;
  role: string;
  initials: string;
  bio: string;
  avatarUrl?: string;
  github?: string;
  linkedin?: string;
};

export const navLinks = [
  { label: "Home", href: "/" },
  { label: "Team", href: "/team" },
  { label: "Contact", href: "/contact" }
];

export const projectGithub = {
  label: "Project GitHub",
  href: "https://github.com/bornayo7/Hack-SMU-VII"
};

export const heroStats = [
  { value: "Visual text", label: "translated directly on the page" },
  { value: "OCR + AI", label: "built into one browser flow" },
  { value: "Demo-ready", label: "for manga, menus, signs, and scans" }
];

export const features = [
  {
    title: "Image-based translation",
    description:
      "Translate words that are locked inside images instead of selectable webpage text.",
    icon: "image"
  },
  {
    title: "OCR text extraction",
    description:
      "Detect text regions, bounding boxes, and readable text from visual content on the page.",
    icon: "scan"
  },
  {
    title: "AI-powered translation",
    description:
      "Turn extracted text into natural translations with configurable translation providers.",
    icon: "languages"
  },
  {
    title: "Browser extension workflow",
    description:
      "Run the experience from the browser toolbar without switching tools or downloading files.",
    icon: "browser"
  },
  {
    title: "Fast visual translation",
    description:
      "Keep the original visual context while translated text appears where users expect it.",
    icon: "sparkles"
  },
  {
    title: "Future document support",
    description:
      "Designed to expand toward PDFs, scanned packets, classroom handouts, and research material.",
    icon: "file"
  }
];

export const howItWorks = [
  {
    step: "01",
    title: "Scan webpage images",
    description:
      "VisionTranslate searches the current page for image-based content that may contain text.",
    icon: "scan"
  },
  {
    step: "02",
    title: "Detect text with OCR",
    description:
      "OCR reads the embedded language and returns text regions with positions on the image.",
    icon: "ocr"
  },
  {
    step: "03",
    title: "Translate with AI",
    description:
      "The extracted copy is translated into the user-selected language.",
    icon: "translate"
  },
  {
    step: "04",
    title: "Overlay translated text",
    description:
      "The extension places the translated result back over the original visual area.",
    icon: "overlay"
  }
];

export const useCases = [
  {
    title: "Manga panels",
    description:
      "Read image-based panels, speech bubbles, and stylized text without leaving the page.",
    image:
      "https://images.unsplash.com/photo-1588497859490-85d1c17db96d?auto=format&fit=crop&w=900&q=80",
    alt: "Colorful printed comic pages"
  },
  {
    title: "Travel signs and menus",
    description:
      "Understand photographed menus, transit signs, posters, and street-level text.",
    image:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
    alt: "Restaurant table with menu and plates"
  },
  {
    title: "Screenshots",
    description:
      "Translate shared screenshots, app captures, and image-based posts quickly.",
    image:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    alt: "Laptop screen with digital work open"
  },
  {
    title: "Educational materials",
    description:
      "Make visual notes, diagrams, handouts, and classroom resources easier to understand.",
    image:
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=900&q=80",
    alt: "Open books and study materials"
  },
  {
    title: "Infographics",
    description:
      "Translate charts, posters, explainers, and social graphics that contain embedded text.",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80",
    alt: "Analytics dashboard and charts on a laptop"
  },
  {
    title: "Scanned documents",
    description:
      "Understand scanned pages, document images, forms, and visual reference material.",
    image:
      "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80",
    alt: "Newspapers and printed documents on a table"
  }
];

export const teamMembers: TeamMember[] = [
  {
    name: "Daniel Oni",
    role: "Backend and OCR Engineer",
    initials: "DO",
    bio:
      "Connects OCR, backend services, and translation APIs into a reliable product pipeline.",
    avatarUrl: "https://github.com/Logan722.png?size=256",
    github: "https://github.com/Logan722",
    linkedin: "https://www.linkedin.com/in/daniel-oni-mscs/"
  },
  {
    name: "Karyn L.D.",
    role: "Product and Frontend Engineer",
    initials: "KL",
    bio:
      "Shapes the presentation layer, user experience, and visual polish for the project.",
    avatarUrl: "https://github.com/KBuildingPrograms.png?size=256",
    github: "https://github.com/KBuildingPrograms",
    linkedin: "https://www.linkedin.com/in/karyn-ld/"
  },
  {
    name: "Ijaz Kiani",
    role: "Full Stack Engineer",
    initials: "IK",
    bio:
      "Builds the website, extension integrations, and full-stack demo experience.",
    avatarUrl: "https://github.com/ijazkiani10.png?size=256",
    github: "https://github.com/ijazkiani10",
    linkedin: "https://www.linkedin.com/in/ijaz-kiani/"
  },
  {
    name: "Yash Baruah",
    role: "Product Engineer",
    initials: "YB",
    bio:
      "Supports product direction, presentation flow, and the polished demo-day experience.",
    avatarUrl: "https://github.com/bornayo7.png?size=256",
    github: "https://github.com/bornayo7",
    linkedin: "https://www.linkedin.com/in/yashbaruah/"
  }
];

export const contactLinks = [
  { label: "Email", href: "mailto:hello@visiontranslate.dev" },
  projectGithub
];

export const githubLinks = teamMembers
  .filter(
    (member): member is TeamMember & { github: string } =>
      Boolean(member.github)
  )
  .map((member) => ({
    label: member.name,
    href: member.github
  }));

export const linkedinLinks = teamMembers
  .filter(
    (member): member is TeamMember & { linkedin: string } =>
      Boolean(member.linkedin)
  )
  .map((member) => ({
    label: member.name,
    href: member.linkedin
  }));
