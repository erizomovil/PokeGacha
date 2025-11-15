const { app, BrowserWindow } = require('electron');
const path = require('path');

const createWindow = () => {
  // Crea la ventana del navegador.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Importante: Habilitar Node.js en el renderizador
      // para que pueda usar 'fs' para la persistencia.
      //preload: path.join(__dirname, 'preload.js'), 
      nodeIntegration: true, // Permite que el 'renderer.js' use require('fs')
      contextIsolation: false // Simplifica el acceso a módulos de Node.js
    }
  });

  // Carga el archivo HTML de la aplicación.
  mainWindow.loadFile('index.html');

  // Opcional: Abre las Herramientas de Desarrollo.
  // mainWindow.webContents.openDevTools();
};

// Este método se llamará cuando Electron haya finalizado
// la inicialización y esté listo para crear ventanas de navegador.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // En macOS, es común recrear una ventana en la aplicación cuando el ícono del dock es clickeado 
    // y no hay otras ventanas abiertas.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Salir cuando todas las ventanas estén cerradas, excepto en macOS.
// En macOS, es común que las aplicaciones y su barra de menú permanezcan activas.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});