import { Component } from "react";
import PropTypes from "prop-types";

const boundEvents = {};

function attachEvents(fromProps) {
  Object.keys(fromProps).forEach(eventKey => {
    const eventCallback = fromProps[eventKey];

    if (boundEvents[eventKey]) {
      boundEvents[eventKey].push(eventCallback);
    } else {
      boundEvents[eventKey] = [eventCallback];
    }
  });
}

function detachEvents(fromProps) {
  Object.keys(fromProps).forEach(eventKey => {
    const eventCallback = fromProps[eventKey];

    boundEvents[eventKey] = boundEvents[eventKey].filter(maybeCallback => {
      return maybeCallback !== eventCallback;
    });
  });
}

export default class OnEditorEvent extends Component {
  static propTypes = {
    onUpArrow: PropTypes.func,
    onDownArrow: PropTypes.func,
    onEscape: PropTypes.func,
    handleReturn: PropTypes.func
  };

  componentDidMount() {
    // do safe checking against `OnEditorEvent.propTypes`
    attachEvents(this.props);
  }

  componentWillReceiveProps(nextProps) {
    detachEvents(this.props);
    attachEvents(nextProps);
  }

  componentWillUnmount() {
    detachEvents(this.props);
  }

  render = () => null;
}

export function callRegisteredEvents(eventKey) {
  return event => {
    if (boundEvents[eventKey]) {
      let lastReturnValue;

      boundEvents[eventKey].some(eventCallback => {
        lastReturnValue = eventCallback(event);
        return event.defaultPrevented;
      });

      return lastReturnValue;
    }
  };
}
