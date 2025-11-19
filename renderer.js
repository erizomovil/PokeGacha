// renderer.js

const fs = require('fs');
const path = require('path');

// --- Configuración y Archivos ---
const POKEMON_DATA = require('./pokemon_data.json'); 
const SAVE_FILE = path.join(__dirname, 'gacha_save.json');

let currentState; // El estado dinámico del juego

// --- Lógica de Persistencia (Cargar/Guardar) ---

const loadState = () => {
    try {
        if (fs.existsSync(SAVE_FILE)) {
            const data = fs.readFileSync(SAVE_FILE, 'utf8');
            const loadedState = JSON.parse(data);
            // Aseguramos que 'coleccion_nombres' exista, incluso si el archivo de guardado es antiguo
            return {
                ...loadedState,
                coleccion_nombres: loadedState.coleccion_nombres || [] // 👈 CAMBIO AQUÍ
            };
        }
        // Estado por defecto CON DOS PITYS
        return {
            pity_legendario_contador: 0, 
            pity_raro_contador: 0,
            tipos_activos: POKEMON_DATA.tipos_base.map(t => t.nombre),
            tipos_con_maestria: [],
            resultados_previos: [],
            coleccion_nombres: [] // 👈 CAMBIO AQUÍ: Array para la colección
        };
    } catch (e) {
        console.error("Error cargando estado. Usando valores por defecto.", e);
        return { 
            pity_legendario_contador: 0, 
            pity_raro_contador: 0, 
            tipos_activos: POKEMON_DATA.tipos_base.map(t => t.nombre), 
            tipos_con_maestria: [], 
            resultados_previos: [],
            coleccion_nombres: [] // 👈 CAMBIO AQUÍ
        }; 
    }
};

const saveState = () => {
    try {
        const data = JSON.stringify(currentState, null, 2);
        fs.writeFileSync(SAVE_FILE, data, 'utf8');
        updateUI(); // Refrescar la interfaz después de guardar
    } catch (e) {
        console.error("Error guardando estado.", e);
    }
};

// --- Utilidades de Gacha ---

const selectWeightedItem = (items, weights) => {
    let totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let randomNum = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
        randomNum -= weights[i];
        if (randomNum <= 0) {
            return items[i];
        }
    }
    return items[items.length - 1]; 
};

// --- Motor de Gacha con Regla de Pity y Maestría ---

// Dentro de renderer.js, función performPull

const performPull = (state, data, count) => {
    let newState = { ...state };
    const results = [];
    const allPokemons = data.pokemons;
    
    const rarities = Object.keys(data.probabilidades_base);
    const weights = Object.values(data.probabilidades_base);

    for (let i = 0; i < count; i++) {
        // 1. Aumentar contadores de Pity
        newState.pity_legendario_contador++;
        newState.pity_raro_contador++;

        // 2. Determinar Rareza Base (Para la probabilidad, no la rareza final en este paso)
        let pulledRarity = selectWeightedItem(rarities, weights);
        
        // 3. Aplicar Pity Duro (Garantías)
        if (newState.pity_legendario_contador >= 90) { 
            pulledRarity = 'legendario'; 
        } else if (newState.pity_raro_contador >= 10) { 
            if (pulledRarity === 'comun'){
                pulledRarity = 'raro'; 
            }
        }
        
        // --- INICIO: BUCLE DE BÚSQUEDA GARANTIZADA (Reroll de Tipo) ---
        let candidates = [];
        let targetTypeName = null;
        let attempts = 0;
        const maxAttempts = 50; 
        let pokemonFound = false;
        
        const activeTypesData = data.tipos_base.filter(t => newState.tipos_activos.includes(t.nombre));
        if (activeTypesData.length === 0) {
             results.push({ nombre: `Error FATAL: Ningún tipo activo`, tipos: [], rareza: 'N/A' });
             continue;
        }

        do {
            attempts++;
            
            // a) Selección de Tipo Objetivo
            targetTypeName = selectWeightedItem(
                activeTypesData.map(t => t.nombre), 
                activeTypesData.map(t => t.probabilidad_base)
            );
            
            // b) Candidatos base por tipo
            candidates = allPokemons.filter(p => p.tipos.includes(targetTypeName));
            
            // c) Aplicar la Regla de Tipo (Monotipo/Maestría)
            if (newState.tipos_con_maestria.includes(targetTypeName)) {
                // Si hay Maestría: Prioridad 80% al Doble Tipo, 20% al resto (incluido Monotipo)
                let dualTypeCandidates = candidates.filter(p => p.tipos.length > 1);
                
                if (dualTypeCandidates.length > 0) {
                    if (Math.random() < 0.8) { 
                        candidates = dualTypeCandidates;
                    } 
                    // else: 20% de chance de mantener la lista completa (mono y doble)
                }
            } else {
                // Si NO hay Maestría: Solo Monotipo
                candidates = candidates.filter(p => p.tipos.length === 1);
            }

            // d) Aplicar Rareza (Filtro final)
            candidates = candidates.filter(p => p.rareza === pulledRarity);

            // NUEVA LÓGICA DE DETECCIÓN DE DUPLICADO
            if (candidates.length > 0) {
                pokemonFound = true;
                break; // Sale del bucle do...while
            }
            
            // Si no se encuentra en el primer intento, se registra el duplicado y se resetea Pity Raro.
            if (attempts === 1 && candidates.length === 0) {
                 results.push({ 
                    nombre: `Duplicado`, 
                    tipos: [targetTypeName || 'N/A'],
                    rareza: pulledRarity
                });
                
                // *** CAMBIO SOLICITADO: Resetear Pity Raro en caso de duplicado ***
                newState.pity_raro_contador = 0; 
                // *****************************************************************
                
                break; // Sale del bucle do...while
            }
            

        } while (attempts < maxAttempts); 
        // --- FIN: BUCLE DE BÚSQUEDA GARANTIZADA ---


        // 5. Selección Final y Reset de Pity
        if (pokemonFound) {
            // Caso: Se encontró un Pokémon 
            const pulledPokemon = candidates[Math.floor(Math.random() * candidates.length)];
            //results.push(pulledPokemon);
            const isDuplicate = newState.coleccion_nombres.includes(pulledPokemon.nombre);
            if (!isDuplicate) {
                // Es nuevo, añádelo a la colección
                newState.coleccion_nombres.push(pulledPokemon.nombre);
            }
            
            // Crear el objeto resultado, añadiendo la propiedad 'esDuplicado'
            const finalResult = { 
                ...pulledPokemon,
                esDuplicado: isDuplicate // 👈 Nuevo campo
            };
            results.push(finalResult);
            // Si sale Raro: Resetea Pity Raro
            if (pulledRarity === 'raro') { 
                newState.pity_raro_contador = 0;
            }
            
            // Si sale Legendario: Resetea Pity Legendario (y Pity Raro)
            if (pulledRarity === 'legendario') { 
                newState.pity_legendario_contador = 0;
                newState.pity_raro_contador = 0;
            }

        } else if (attempts === maxAttempts && candidates.length === 0) {
            // Caso: Error Crítico (solo si el bucle terminó por maxAttempts sin encontrar nada)
            results.push({ 
                nombre: `Error Crítico: No se encontró Pokémon válido en ${maxAttempts} intentos.`, 
                tipos: [targetTypeName || 'N/A'],
                rareza: pulledRarity
            });
            // NOTA: En este caso de error crítico, el Pity Raro NO se resetea.
        }
    }
    
    newState.resultados_previos = results.concat(newState.resultados_previos).slice(0, 50);

    return { newState, results };
};

const handlePull = () => { 
    const pullCount = parseInt(document.getElementById('pull-count').value) || 1;
    if (currentState.tipos_activos.length === 0) {
        alert("¡Activa al menos un tipo para poder tirar!");
        return;
    }
    
    const { newState, results } = performPull(currentState, POKEMON_DATA, pullCount); 
    
    currentState = newState;
    saveState(); 
    displayResults(results);
};

// !reset
const handleReset = () => { 
    currentState.pity_legendario_contador = 0;
    currentState.pity_raro_contador = 0;
    saveState();
    alert("Contadores de Pity reseteados a 0.");
};

// !setpity <valor> (Solo permite ajustar el Pity Legendario)
const handleSetPity = () => { 
    const pityInput = document.getElementById('pity-input');
    const newPity = parseInt(pityInput.value);
    
    if (isNaN(newPity) || newPity < 0 || newPity > 90) {
        alert("Para el Pity Legendario, introduce un número entre 0 y 90.");
        return;
    }
    
    currentState.pity_legendario_contador = newPity;
    pityInput.value = '';
    saveState();
    alert(`Pity Legendario establecido a ${newPity}.`);
};

const performGuaranteedPull = (targetRarity) => {
    // 1. Selección del Tipo Objetivo (La misma lógica que en performPull)
    const activeTypesData = POKEMON_DATA.tipos_base.filter(t => currentState.tipos_activos.includes(t.nombre));
    if (activeTypesData.length === 0) {
        alert("Error: Ningún tipo activo para tirar.");
        return { results: [] };
    }
    
    const targetTypeName = selectWeightedItem(
        activeTypesData.map(t => t.nombre), 
        activeTypesData.map(t => t.probabilidad_base)
    );
    
    // 2. Filtrado: Reglas de Monotipo/Maestría (Tipo de Pokémon)
    let candidates = POKEMON_DATA.pokemons.filter(p => p.tipos.includes(targetTypeName));
    
    if (currentState.tipos_con_maestria.includes(targetTypeName)) {
        // Si hay MAESTRÍA: Solo Doble Tipo (o más)
        let dualTypeCandidates = candidates.filter(p => p.tipos.length > 1);
        if (dualTypeCandidates.length > 0) {
            candidates = dualTypeCandidates;
        }
    } else {
        // Si NO hay MAESTRÍA: Solo Monotipo
        candidates = candidates.filter(p => p.tipos.length === 1);
    }
    
    // 3. Filtrado Final: Aplicar la rareza forzada
    candidates = candidates.filter(p => p.rareza === targetRarity);
    
    let pulledPokemon;
    if (candidates.length > 0) {
        pulledPokemon = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        pulledPokemon = { 
            nombre: `ERROR: No hay ${targetRarity} de tipo ${targetTypeName} disponible`, 
            tipos: [targetTypeName],
            rareza: 'N/A' 
        };
    }

    return { results: [pulledPokemon] };
};

const handleClearHistory = () => {
    // Comando para borrar el historial de resultados guardados
    currentState.resultados_previos = []; 
    saveState(); // Guardar el estado sin historial
    
    // Limpiar visualmente la grilla de resultados en el HTML
    document.getElementById('results-grid').innerHTML = ''; 
    
    alert("Historial de resultados previos borrado.");
};

const handlePullLegendarioGuaranteed = () => {
    console.log("Comando: !pull_legendario_garantizado (No afecta pity)");
    const { results } = performGuaranteedPull('legendario');
    
    // NO se llama a saveState, solo se actualiza la visualización de resultados
    displayResults(results); 
};

const handlePullRaroGuaranteed = () => {
    console.log("Comando: !pull_raro_garantizado (No afecta pity)");
    const { results } = performGuaranteedPull('raro');
    
    // NO se llama a saveState
    displayResults(results); 
};

const handleRevealAll = () => {
    // Selecciona todas las tarjetas de Pokémon que aún están cubiertas
    const coveredCards = document.querySelectorAll('#results-grid .pokemon-card.covered');
    
    coveredCards.forEach(card => {
        card.classList.remove('covered');
        card.classList.add('revealed');
    });
    
    console.log(`¡Todos los ${coveredCards.length} resultados han sido revelados!`);
};

const handleToggleAllTypes = () => {
    // Si hay tipos activos, los desactivamos todos. Si no hay, los activamos todos.
    const allTypesNames = POKEMON_DATA.tipos_base.map(t => t.nombre);
    
    if (currentState.tipos_activos.length > 0) {
        // Desactivar todos
        currentState.tipos_activos = [];
        // Al desactivar un tipo, su maestría también se debe desactivar
        currentState.tipos_con_maestria = []; 
        console.log("Todos los tipos han sido desactivados.");
    } else {
        // Activar todos
        currentState.tipos_activos = allTypesNames;
        console.log("Todos los tipos han sido activados.");
    }
    
    saveState();
};

// Nueva función para Activar/Desactivar todas las Maestrías
const handleToggleAllMastery = () => {
    const activeTypes = currentState.tipos_activos;
    
    if (currentState.tipos_con_maestria.length > 0) {
        // Desactivar todas las maestrías
        currentState.tipos_con_maestria = [];
        console.log("Todas las maestrías han sido desactivadas.");
    } else if (activeTypes.length > 0) {
        // Activar maestría en todos los tipos activos
        currentState.tipos_con_maestria = [...activeTypes]; // Copiar los activos
        console.log("Maestría activada en todos los tipos activos.");
    } else {
        alert("¡No hay tipos activos para aplicar la Maestría!");
        return;
    }
    
    saveState();
};

// !addtype / !removetype
window.toggleType = (typeName) => { 
    const index = currentState.tipos_activos.indexOf(typeName);
    if (index > -1) {
        currentState.tipos_activos.splice(index, 1);
        currentState.tipos_con_maestria = currentState.tipos_con_maestria.filter(t => t !== typeName);
    } else {
        currentState.tipos_activos.push(typeName);
    }
    saveState();
};

// !mastery / !removemastery
window.toggleMastery = (typeName) => { 
    const index = currentState.tipos_con_maestria.indexOf(typeName);
    if (index > -1) {
        currentState.tipos_con_maestria.splice(index, 1); 
    } else if (currentState.tipos_activos.includes(typeName)) {
        currentState.tipos_con_maestria.push(typeName); 
    }
    saveState();
};


// --- Actualización de la Interfaz (!showactives y Resultados) ---

const displayResults = (results) => {
    const grid = document.getElementById('results-grid');
    grid.innerHTML = ''; 
    
    results.forEach((pokemon , index) => {
        const resultDiv = document.createElement('div');
        resultDiv.className = `pokemon-card ${pokemon.rareza} covered`; 
        resultDiv.dataset.index = index;
        resultDiv.dataset.nombre = pokemon.nombre;
        resultDiv.dataset.tipos = pokemon.tipos.join(' / ');
        resultDiv.dataset.rareza = pokemon.rareza.toUpperCase();
        let masteryTag = '';
        if (pokemon.tipos.length > 1) {
            masteryTag = '<span class="mastery-tag">[DOBLE TIPO]</span>';
        }
        let duplicateTag = '';
        if (pokemon.esDuplicado) { // 👈 Comprueba la bandera añadida en performPull
            duplicateTag = '<br><span class="duplicate-tag" style="color: red; font-weight: bold; font-size: 1.1em;">Duplicado</span>'; 
        }
        // Si el resultado es el caso especial de "Duplicado" (fallo de búsqueda de tipo)
        if (pokemon.nombre === 'Duplicado') { 
            duplicateTag = '<br><span style="color: blue; font-weight: bold; font-size: 1.1em;">Falló Búsqueda (Reset Pity Raro)</span>';
        }
        const revealedContent = `
            <div class="revealed-content">
                <strong>${pokemon.nombre}</strong> ${masteryTag}${duplicateTag}<br>
                <small>Rareza: ${pokemon.rareza.toUpperCase()}</small><br>
                <small>Tipo(s): ${pokemon.tipos.join(' / ')}</small>
            </div>
        `;
        const coveredContent = `
            <div class="covered-content">
                <p><strong>RAREZA:</strong></p>
                <p style="font-size: 1.2em; font-weight: bold;">${pokemon.rareza.toUpperCase()}</p>
                <small style="margin-top: 5px; display: block;">¡Haz clic para revelar!</small>
            </div>
        `;

        resultDiv.innerHTML = coveredContent + revealedContent;
        
        resultDiv.addEventListener('click', function() {
            if (this.classList.contains('covered')) {
                this.classList.remove('covered');
                this.classList.add('revealed');
                console.log(`Revelado: ${pokemon.nombre} (${pokemon.rareza}) - Duplicado: ${!!pokemon.esDuplicado}`);
            }
        });
        grid.appendChild(resultDiv);
    });
};

const updateUI = () => { // Simula el comando !showactives
    // Actualización de Pity Legendario (Barra principal)
    document.getElementById('pity-legendario-display').textContent = `${currentState.pity_legendario_contador} / 90`;
    document.getElementById('pity-legendario-bar').style.width = `${(currentState.pity_legendario_contador / 90) * 100}%`;
    
    // Actualización de Pity Raro
    document.getElementById('pity-raro-display').textContent = `${currentState.pity_raro_contador} / 10`;
    document.getElementById('pity-raro-bar').style.width = `${(currentState.pity_raro_contador / 10) * 100}%`;
    
    // Texto de la sección de comandos
    document.getElementById('pity-display-text').innerHTML = `
        Legendario: <span style="font-weight: bold;">${currentState.pity_legendario_contador} / 90</span> | 
        Raro: <span style="font-weight: bold;">${currentState.pity_raro_contador} / 10</span>
    `;
    
    // Generar Controles de Tipos
    const typeContainer = document.getElementById('type-controls');
    typeContainer.innerHTML = ''; 
    
    POKEMON_DATA.tipos_base.forEach(type => {
        const typeName = type.nombre;
        const isActive = currentState.tipos_activos.includes(typeName);
        const hasMastery = currentState.tipos_con_maestria.includes(typeName);
        
        const typeDiv = document.createElement('div');
        typeDiv.className = 'type-control';
        
        let statusText = isActive ? 'ACTIVO ✅' : 'DESACTIVADO ❌';
        let masteryText = hasMastery ? ' (MAESTRÍA ACTIVA ⭐)' : '';
        
        typeDiv.innerHTML = `
            <span style="flex-grow: 1;"><strong>${typeName}</strong> - ${statusText} ${masteryText}</span>
            <div>
                <button onclick="toggleType('${typeName}')" class="${isActive ? 'remove' : 'add'}">${isActive ? 'Quitar Tipo' : 'Añadir Tipo'}</button>
                <button onclick="toggleMastery('${typeName}')" ${!isActive ? 'disabled' : ''} class="${hasMastery ? 'remove' : 'add'}">${hasMastery ? 'Quitar Maestría' : 'Añadir Maestría'}</button>
            </div>
        `;
        typeContainer.appendChild(typeDiv);
    });
};

// --- Inicialización ---

window.onload = () => {
    currentState = loadState();
    updateUI();
    
    // Asignar listeners a botones de comandos
    document.getElementById('pull-button').addEventListener('click', handlePull);
    document.getElementById('reset-button').addEventListener('click', handleReset);
    document.getElementById('set-pity-button').addEventListener('click', handleSetPity);
    document.getElementById('pull-legendario-guaranteed').addEventListener('click', handlePullLegendarioGuaranteed);
    document.getElementById('pull-raro-guaranteed').addEventListener('click', handlePullRaroGuaranteed);
    document.getElementById('clear-history-button').addEventListener('click', handleClearHistory);
    document.getElementById('reveal-all-button').addEventListener('click', handleRevealAll);
    document.getElementById('toggle-all-types').addEventListener('click', handleToggleAllTypes);
    document.getElementById('toggle-all-mastery').addEventListener('click', handleToggleAllMastery);
};