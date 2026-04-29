export type ChapterTopicMap = Record<string, string[]>;
export type SyllabusNode = Record<string, ChapterTopicMap>;

function chapterListToMap(chapters: string[]): ChapterTopicMap {
    const out: ChapterTopicMap = {};
    chapters.forEach((chapter) => {
        out[chapter] = [`${chapter} Basics`, `${chapter} PYQ Patterns`, `${chapter} Advanced Applications`];
    });
    return out;
}

function makeFoundationSyllabus(classNum: number): SyllabusNode {
    const classWiseMaths: Record<number, string[]> = {
        1: ['Shapes and Space', 'Numbers from One to Nine', 'Addition', 'Subtraction', 'Measurement'],
        2: ['What is Long What is Round', 'Counting in Groups', 'Addition and Subtraction', 'Money', 'Data Handling'],
        3: ['Where to Look From', 'Fun with Numbers', 'Give and Take', 'Time Goes On', 'Smart Charts'],
        4: ['Building with Bricks', 'Long and Short', 'A Trip to Bhopal', 'Halves and Quarters', 'Tables and Shares'],
        5: ['The Fish Tale', 'Shapes and Angles', 'How Many Squares', 'Tenths and Hundredths', 'Smart Charts'],
    };
    const classWiseEvs: Record<number, string[]> = {
        1: ['My Family and Me', 'Food We Eat', 'Water', 'Plants Around Us', 'Animals Around Us'],
        2: ['Our Needs', 'Our Shelter', 'Travel and Communication', 'Plants and Animals', 'Weather'],
        3: ['Poonam Day Out', 'The Plant Fairy', 'Water O Water', 'Families Can Be Different', 'Work We Do'],
        4: ['Going to School', 'Nandita in Mumbai', 'A River Story', 'Changing Families', 'Food and Fun'],
        5: ['Super Senses', 'A Snake Charmer Story', 'From Tasting to Digesting', 'Sunita in Space', 'Blow Hot Blow Cold'],
    };
    const classWiseEnglish: Record<number, string[]> = {
        1: ['A Happy Child', 'Three Little Pigs', 'After a Bath', 'Lalu and Peelu'],
        2: ['First Day at School', 'I am Lucky', 'A Smile', 'Rain'],
        3: ['Good Morning', 'Bird Talk', 'Puppy and I', 'Little by Little'],
        4: ['Wake Up', 'Neha Alarm Clock', 'Noses', 'Alice in Wonderland'],
        5: ['Ice-cream Man', 'Wonderful Waste', 'Teamwork', 'My Shadow'],
    };
    const classWiseHindi: Record<number, string[]> = {
        1: ['Jhoola', 'Aam ki Kahani', 'Patte hi Patte', 'Pakodi'],
        2: ['Oont Chala', 'Bhallu ne Kheli Football', 'Meri Kitaab', 'Titli aur Kali'],
        3: ['Kakku', 'Shekhibaaz Makhi', 'Chand Wali Amma', 'Mann Karta Hai'],
        4: ['Man ke Bhole Bhale Badal', 'Jaisa Sawal Waisa Jawab', 'Kirmitch', 'Paani Re Paani'],
        5: ['Rakh ki Rassi', 'Faslon ka Tyohar', 'Ek Maa ki Bebasi', 'Nanha Fankar'],
    };

    return {
        English: chapterListToMap(classWiseEnglish[classNum] || []),
        Hindi: chapterListToMap(classWiseHindi[classNum] || []),
        Maths: chapterListToMap(classWiseMaths[classNum] || []),
        EVS: chapterListToMap(classWiseEvs[classNum] || []),
    };
}

function makeMiddleSchoolSyllabus(classNum: number): SyllabusNode {
    const mathsByClass: Record<number, string[]> = {
        6: ['Knowing Our Numbers', 'Whole Numbers', 'Integers', 'Fractions', 'Decimals', 'Algebra', 'Ratio and Proportion', 'Mensuration'],
        7: ['Integers', 'Fractions and Decimals', 'Data Handling', 'Simple Equations', 'Lines and Angles', 'Triangles', 'Comparing Quantities', 'Perimeter and Area'],
        8: ['Rational Numbers', 'Linear Equations in One Variable', 'Understanding Quadrilaterals', 'Practical Geometry', 'Data Handling', 'Squares and Square Roots', 'Cubes and Cube Roots', 'Mensuration'],
        9: ['Number Systems', 'Polynomials', 'Coordinate Geometry', 'Linear Equations in Two Variables', 'Euclid Geometry', 'Triangles', 'Quadrilaterals', 'Statistics'],
        10: ['Real Numbers', 'Polynomials', 'Pair of Linear Equations', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Circles', 'Probability'],
    };
    const scienceByClass: Record<number, string[]> = {
        6: ['Food Where Does it Come From', 'Components of Food', 'Fibre to Fabric', 'Sorting Materials', 'Motion and Measurement', 'Light Shadows and Reflections', 'Electricity and Circuits', 'Living Organisms'],
        7: ['Nutrition in Plants', 'Nutrition in Animals', 'Heat', 'Acids Bases and Salts', 'Physical and Chemical Changes', 'Respiration in Organisms', 'Transportation in Animals and Plants', 'Reproduction in Plants'],
        8: ['Crop Production and Management', 'Microorganisms Friend and Foe', 'Coal and Petroleum', 'Combustion and Flame', 'Conservation of Plants and Animals', 'Cell Structure and Functions', 'Force and Pressure', 'Light'],
        9: ['Matter in Our Surroundings', 'Is Matter Around Us Pure', 'Atoms and Molecules', 'Cell', 'Tissues', 'Motion', 'Force and Laws of Motion', 'Gravitation'],
        10: ['Chemical Reactions and Equations', 'Acids Bases and Salts', 'Metals and Non-metals', 'Carbon and Compounds', 'Life Processes', 'Control and Coordination', 'Light Reflection and Refraction', 'Electricity'],
    };
    const englishByClass: Record<number, string[]> = {
        6: ['Who Did Patrick Homework', 'How the Dog Found Himself', 'Taro Reward', 'An Indian American Woman in Space'],
        7: ['Three Questions', 'A Gift of Chappals', 'Gopal and the Hilsa Fish', 'The Ashes that Made Trees Bloom'],
        8: ['The Best Christmas Present', 'The Tsunami', 'Glimpses of the Past', 'Bepin Choudhury Lapse of Memory'],
        9: ['The Fun They Had', 'The Sound of Music', 'The Little Girl', 'A Truly Beautiful Mind'],
        10: ['A Letter to God', 'Nelson Mandela', 'Two Stories About Flying', 'From the Diary of Anne Frank'],
    };
    const hindiByClass: Record<number, string[]> = {
        6: ['Vah Chidiya Jo', 'Bachpan', 'Nadaan Dost', 'Chand Se Thodi Si Gappein'],
        7: ['Hum Panchhi Unmukt Gagan Ke', 'Dadi Maa', 'Himalay ki Betiyan', 'Mithaiwala'],
        8: ['Dhvani', 'Lakh ki Chudiyan', 'Bus ki Yatra', 'Diwanon ki Hasti'],
        9: ['Do Bailon ki Katha', 'Lhasa ki Ore', 'Upbhokta Vad ki Sanskriti', 'Sawaiya'],
        10: ['Bade Bhai Sahab', 'Diary ka Ek Panna', 'Tantaraa Vamiro Katha', 'Surdas ke Pad'],
    };
    return {
        Maths: chapterListToMap(mathsByClass[classNum] || mathsByClass[10]),
        Science: chapterListToMap(scienceByClass[classNum] || scienceByClass[10]),
        English: chapterListToMap(englishByClass[classNum] || englishByClass[10]),
        Hindi: chapterListToMap(hindiByClass[classNum] || hindiByClass[10]),
    };
}

const XI_XII = {
    Physics: {
        'Units and Measurements': ['Physical quantities', 'SI units', 'Dimensional analysis', 'Significant figures', 'Errors in measurement'],
        Kinematics: ['Motion in one dimension', 'Motion in two dimensions', 'Relative velocity', 'Projectile motion', 'Uniform circular motion'],
        'Laws of Motion': ['Newton laws', 'Free body diagram', 'Friction', 'Pseudo force', 'Dynamics in circular motion'],
        'Work Energy Power': ['Work done', 'Kinetic energy', 'Potential energy', 'Power', 'Work-energy theorem', 'Conservation of energy'],
        'System of Particles': ['Center of mass', 'Linear momentum', 'Impulse', 'Conservation of momentum', 'Collisions', 'Rocket propulsion'],
        Gravitation: ['Universal gravitation', 'Acceleration due to gravity', 'Gravitational potential', 'Escape velocity', 'Satellites and orbital motion'],
        'Mechanical Properties of Solids': ['Stress and strain', 'Elastic moduli', 'Poisson ratio', 'Hooke law'],
        'Mechanical Properties of Fluids': ['Pressure', 'Pascal law', 'Buoyancy', 'Surface tension', 'Viscosity', 'Bernoulli principle'],
        Thermodynamics: ['Thermal equilibrium', 'First law', 'Second law', 'Heat engines', 'Carnot engine', 'Entropy basics'],
        'Kinetic Theory': ['Postulates', 'Pressure and temperature relation', 'Degrees of freedom', 'Mean free path'],
        'Oscillations and Waves': ['SHM', 'Energy in SHM', 'Damped and forced oscillations', 'Wave equation', 'Superposition', 'Standing waves', 'Doppler effect'],
        Electrostatics: ['Electric charges', 'Coulomb law', 'Electric field', 'Electric potential', 'Capacitance', 'Dielectrics', 'Gauss law'],
        'Current Electricity': ['Drift velocity', 'Ohm law', 'Kirchhoff laws', 'Wheatstone bridge', 'Potentiometer', 'Cells and EMF'],
        Magnetism: ['Magnetic field', 'Biot-Savart law', 'Ampere law', 'Force on moving charge', 'Cyclotron', 'Earth magnetism'],
        'Magnetism and Matter': ['Bar magnet', 'Magnetic materials', 'Hysteresis'],
        'Electromagnetic Induction': ['Faraday law', 'Lenz law', 'Self and mutual inductance', 'AC generator', 'Eddy currents'],
        'Alternating Current': ['AC voltage and current', 'Reactance', 'LCR circuit', 'Resonance', 'Transformer', 'Power factor'],
        'Electromagnetic Waves': ['Displacement current', 'EM spectrum', 'Wave properties'],
        Optics: ['Reflection', 'Refraction', 'Lens and mirror formula', 'Optical instruments', 'Wave optics', 'Interference', 'Diffraction', 'Polarisation'],
        'Dual Nature of Radiation and Matter': ['Photoelectric effect', 'de Broglie wavelength', 'Matter waves'],
        'Atoms and Nuclei': ['Bohr model', 'Atomic spectra', 'Radioactivity', 'Nuclear reactions', 'Binding energy'],
        'Semiconductor Electronics': ['Intrinsic and extrinsic semiconductors', 'Diodes', 'Rectifiers', 'Transistors', 'Logic gates'],
        'Communication Systems': ['Elements of communication', 'Modulation', 'Bandwidth'],
    },
    Chemistry: {
        'Some Basic Concepts of Chemistry': ['Mole concept', 'Empirical and molecular formula', 'Stoichiometry', 'Limiting reagent'],
        'Structure of Atom': ['Atomic models', 'Quantum numbers', 'Electronic configuration', 'Bohr model'],
        'Classification of Elements and Periodicity': ['Periodic trends', 'Atomic and ionic radii', 'Ionisation enthalpy', 'Electron affinity'],
        'Chemical Bonding and Molecular Structure': ['Ionic bond', 'Covalent bond', 'VSEPR', 'Hybridisation', 'Molecular orbital theory', 'Hydrogen bonding'],
        'States of Matter': ['Gas laws', 'Kinetic theory', 'Real gases', 'Liquefaction'],
        Thermodynamics: ['System and surroundings', 'Enthalpy', 'Entropy', 'Gibbs free energy', 'Hess law'],
        Equilibrium: ['Chemical equilibrium', 'Le Chatelier principle', 'Acid-base equilibrium', 'Ionic equilibrium', 'Buffer solutions'],
        'Redox Reactions': ['Oxidation number', 'Balancing redox equations', 'Disproportionation'],
        'Hydrogen and s-Block Elements': ['Hydrogen properties', 'Alkali metals', 'Alkaline earth metals', 'Anomalous behaviour'],
        'p-Block Elements (XI)': ['Group 13 and 14 trends', 'Boron family', 'Carbon family'],
        'Organic Chemistry Basics': ['IUPAC nomenclature', 'Electronic effects', 'Reaction intermediates', 'Isomerism'],
        Hydrocarbons: ['Alkanes', 'Alkenes', 'Alkynes', 'Aromatic hydrocarbons', 'Mechanisms'],
        'Environmental Chemistry': ['Pollution', 'Green chemistry', 'Atmospheric chemistry'],
        Solutions: ['Concentration terms', 'Raoult law', 'Colligative properties', 'Abnormal molar mass'],
        Electrochemistry: ['Conductance', 'Electrochemical cells', 'Nernst equation', 'Electrolysis'],
        'Chemical Kinetics': ['Rate law', 'Order and molecularity', 'Integrated rate equations', 'Arrhenius equation'],
        'Surface Chemistry': ['Adsorption', 'Catalysis', 'Colloids', 'Emulsions'],
        'General Principles and Processes of Isolation': ['Metallurgy', 'Concentration', 'Reduction', 'Refining'],
        'p-Block Elements (XII)': ['Group 15 to 18', 'Nitrogen family', 'Oxygen family', 'Halogens', 'Noble gases'],
        'd and f Block Elements': ['Transition elements', 'Lanthanides and actinides', 'Oxidation states', 'Complex formation'],
        'Coordination Compounds': ['Nomenclature', 'Isomerism', 'Bonding', 'Crystal field theory'],
        Haloalkanes: ['Preparation and properties', 'SN1 SN2 mechanisms', 'Elimination reactions'],
        Haloarenes: ['Nucleophilic substitution in aryl halides', 'Electrophilic substitution'],
        Alcohols: ['Preparation', 'Properties', 'Oxidation', 'Dehydration'],
        Phenols: ['Acidity', 'Electrophilic substitution', 'Reimer-Tiemann reaction'],
        Ethers: ['Williamson synthesis', 'Cleavage'],
        Aldehydes: ['Nucleophilic addition', 'Oxidation and reduction', 'Aldol condensation'],
        Ketones: ['Carbonyl chemistry', 'Nucleophilic addition'],
        'Carboxylic Acids': ['Acidity', 'Derivatives', 'Important reactions'],
        Amines: ['Basicity', 'Preparation', 'Diazotisation', 'Coupling reactions'],
        Biomolecules: ['Carbohydrates', 'Proteins', 'Nucleic acids', 'Vitamins'],
        Polymers: ['Addition and condensation polymers', 'Biodegradable polymers'],
        'Chemistry in Everyday Life': ['Drugs', 'Cleansing agents', 'Food chemistry'],
    },
    Maths: {
        'Sets and Relations': ['Set operations', 'Intervals', 'Cartesian product', 'Relations', 'Functions'],
        'Trigonometric Functions': ['Angles and measures', 'Identities', 'Graphs', 'Inverse trigonometric functions'],
        'Complex Numbers and Quadratic Equations': ['Argand plane', 'Polar form', 'Roots of equations'],
        'Linear Inequalities': ['Solution sets', 'Graphical representation'],
        'Permutations and Combinations': ['Fundamental counting principle', 'Permutations', 'Combinations', 'Applications'],
        'Binomial Theorem': ['General term', 'Middle term', 'Binomial expansions', 'Properties'],
        'Sequences and Series': ['AP GP HP', 'Summation', 'Special series'],
        'Straight Lines': ['Slope form', 'Two-point form', 'Distance formula', 'Angle between lines'],
        ConicSections: ['Parabola', 'Ellipse', 'Hyperbola', 'Standard equations'],
        'Introduction to 3D Geometry': ['Coordinates in space', 'Distance formula', 'Section formula'],
        Limits: ['Algebra of limits', 'Standard limits', 'LHL'],
        Derivatives: ['Differentiation rules', 'Chain rule', 'Trigonometric derivatives', 'Applications basics'],
        Matrices: ['Types of matrices', 'Matrix operations', 'Transpose'],
        Determinants: ['Properties', 'Minors and cofactors', 'Adjoint and inverse'],
        'Continuity and Differentiability': ['Continuity', 'Differentiability', 'Implicit differentiation', 'Higher derivatives'],
        'Application of Derivatives': ['Increasing decreasing functions', 'Maxima minima', 'Tangents and normals'],
        Integrals: ['Indefinite integrals', 'Definite integrals', 'Properties', 'Area under curves'],
        'Differential Equations': ['Order and degree', 'Variable separable form', 'Linear differential equations'],
        'Vectors and 3D Geometry': ['Vector algebra', 'Dot and cross product', 'Lines and planes'],
        'Linear Programming': ['Formulation', 'Feasible region', 'Corner point method'],
        Probability: ['Conditional probability', 'Bayes theorem', 'Random variables', 'Mean and variance'],
    },
    Biology: {
        'The Living World': ['Biodiversity', 'Taxonomic hierarchy', 'Nomenclature'],
        'Biological Classification': ['Kingdom systems', 'Protista', 'Fungi', 'Monera'],
        'Plant Kingdom': ['Algae', 'Bryophytes', 'Pteridophytes', 'Gymnosperms', 'Angiosperms'],
        'Animal Kingdom': ['Classification basis', 'Non chordates', 'Chordates'],
        'Morphology of Flowering Plants': ['Root stem leaf', 'Inflorescence', 'Flower', 'Fruit', 'Seed'],
        'Anatomy of Flowering Plants': ['Tissues', 'Dicot and monocot anatomy', 'Secondary growth'],
        'Structural Organisation in Animals': ['Animal tissues', 'Earthworm', 'Cockroach', 'Frog'],
        'Cell Structure and Function': ['Cell organelles', 'Cell membrane', 'Cell cycle'],
        Biomolecules: ['Carbohydrates', 'Proteins', 'Lipids', 'Enzymes', 'Nucleic acids'],
        'Plant Physiology': ['Transport in plants', 'Mineral nutrition', 'Photosynthesis', 'Respiration', 'Plant growth regulators'],
        'Human Physiology': ['Digestion', 'Respiration', 'Circulation', 'Excretion', 'Locomotion', 'Neural and chemical coordination'],
        Reproduction: ['Asexual and sexual reproduction', 'Human reproduction', 'Reproductive health'],
        'Genetics and Evolution': ['Mendelian genetics', 'Molecular basis of inheritance', 'Evolution theories'],
        'Biology in Human Welfare': ['Human health and disease', 'Microbes in human welfare'],
        Biotechnology: ['Principles and processes', 'Genetic engineering', 'Biotech applications'],
        Ecology: ['Organisms and environment', 'Ecosystem', 'Biodiversity and conservation'],
    },
};

export function getSyllabusByClassAndExam(className: string, examType: string): SyllabusNode {
    const c = Number(className);
    const exam = String(examType || 'boards').toLowerCase();

    if (Number.isFinite(c) && c >= 1 && c <= 5) {
        return makeFoundationSyllabus(c);
    }
    if (Number.isFinite(c) && c >= 6 && c <= 10) {
        return makeMiddleSchoolSyllabus(c);
    }
    if (Number.isFinite(c) && c >= 11) {
        if (exam === 'neet') {
            return {
                Physics: XI_XII.Physics,
                Chemistry: XI_XII.Chemistry,
                Biology: XI_XII.Biology,
            };
        }
        if (exam === 'jee') {
            return {
                Physics: XI_XII.Physics,
                Chemistry: XI_XII.Chemistry,
                Maths: XI_XII.Maths,
            };
        }
        return XI_XII;
    }
    return makeMiddleSchoolSyllabus(10);
}
