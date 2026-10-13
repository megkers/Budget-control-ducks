import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './App.jsx';

// #root is in index.html, so this is never null.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
