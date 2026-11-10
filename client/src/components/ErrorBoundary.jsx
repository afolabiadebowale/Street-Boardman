import React from 'react';
import { captureException } from '../errorTracking.js';
import { Card } from './ui/card';
import { Button } from './ui/button';

// Without this, any uncaught render error unmounts the whole tree and the
// user is left staring at a blank white page with no way forward.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    captureException(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Card className="m-4 flex-1" role="alert">
        <h2>Something went wrong</h2>
        <p className="text-sm text-muted">Your money and bets are safe. Please reload the page to continue.</p>
        <Button type="button" variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Card>
    );
  }
}
