/*jshint esversion: 6*/

import Composer from 'discourse/models/composer';
import { withPluginApi } from 'discourse/lib/plugin-api';
import computed from 'ember-addons/ember-computed-decorators';
import NavigationItem from 'discourse/components/navigation-item';
import CategoryDrop from 'discourse/components/category-drop';
import DiscoveryTopicsController from 'discourse/controllers/discovery/topics';
import TopicTrackingState from 'discourse/models/topic-tracking-state';
import { on } from 'ember-addons/ember-computed-decorators';
import ComposerEditor from 'discourse/components/composer-editor';
import DiscoveryTopics from 'discourse/controllers/discovery/topics';
import TopicView from 'discourse/views/topic';
import TopicModel from 'discourse/models/topic';
import TopicController from 'discourse/controllers/topic';
import TopicRouter from 'discourse/routes/topic';
import TopicFromParamsRouter from 'discourse/routes/topic-from-params';
import MountWidget from 'discourse/components/mount-widget';

// startsWith polyfill from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

export default {
    name: 'extend-for-projects',
    initialize() {
        // Setting this value is what makes new topics actually able to appear in the target project
        Composer.serializeOnCreate('parent_guids');

        function fixUrls() {
            var projectGuid = null;
            var navMode = '';
            var viewOnly = '';
            var queryString = '';

            var container = Discourse.__container__;
            var route = container.lookup('controller:Application').currentPath;

            if (route.startsWith('topic')) {
                var topicController = container.lookup('controller:topic');
                var topicModel = topicController.model;
                if (topicModel && topicModel.parent_guids) {
                    projectGuid = topicModel.parent_guids[0];
                }
                viewOnly = topicController.view_only;
                queryString = viewOnly ? '?view_only=' + viewOnly : '';
            } else if (route.startsWith('projects.show') || route.startsWith('projects.top')) {
                var topicsController = container.lookup('controller:discovery.topics');
                var topicsModel = topicsController.model;
                if (topicsModel && topicsModel.topic_list.parent_guids) {
                    projectGuid = topicsModel.topic_list.parent_guids[0];
                    navMode = topicsModel.navMode;
                }
                viewOnly = topicsController.view_only;
                queryString = viewOnly ? '?view_only=' + viewOnly : '';
            }

            if (projectGuid) {
                var categoryLinks = document.querySelectorAll('.cat a, a.bullet');
                _.each(categoryLinks, link => {
                    if (!link.pathname.startsWith('/forum/')) {
                        link.pathname = '/forum/' + projectGuid + link.pathname;
                        link.search = queryString;
                    }
                });

                var footerLinks = document.querySelectorAll('h3 a');
                _.each(footerLinks, link => {
                    // normal non-ember-created links
                    if (link.id == '') {
                        if (link.pathname == '/latest') {
                            link.pathname = '/forum/' + projectGuid + link.pathname;
                            link.search = queryString;
                        }
                        return;
                    }
                    // These links were made by the link-to helper so they need to be modified
                    // in the ember View. This seems kinda convoluted...
                    var view = Ember.View.views[link.id];
                    var href = view.get('href');
                    if (href == '/' || href == '/latest') {
                        view.set('href', '/forum/' + projectGuid + queryString); // for appearance
                        view.set('loadedParams.targetRouteName', 'projects.show');
                        view.set('loadedParams.models', [projectGuid]);
                    } else if (href == '/categories') {
                        view.set('href', '/forum/' + projectGuid + '/' + navMode + queryString);
                        if (navMode.startsWith('top')) {
                            view.set('loadedParams.targetRouteName', 'projects.' + navMode);
                        } else {
                            view.set('loadedParams.targetRouteName', 'projects.show' + navMode.capitalize());
                        }
                        view.set('loadedParams.models', [projectGuid]);
                    }
                    view.set('loadedParams.queryParams', {view_only: viewOnly});
                });

                // Add the view_only id to all topics on the list
                if (route.startsWith('projects.show') || route.startsWith('projects.top')) {
                    var topicTitleLinks = document.querySelectorAll('.main-link a');
                    _.each(topicTitleLinks, link => {
                        link.search = queryString;
                    });
                }
            }
        }

        withPluginApi('0.1', api => {
            api.onPageChange((url, title) => {
                Ember.run.scheduleOnce('afterRender', fixUrls);
            });
        });

        TopicView.reopen({
            domChange: function() {
                Ember.run.scheduleOnce('afterRender', fixUrls);
            }.on('didInsertElement')
        });

        TopicModel.reopen({
            updateFromJson(json) {
                this._super(json);
                Ember.run.scheduleOnce('afterRender', fixUrls);
            },

            // We have to add the view_only parameter to all of these urls...
            baseUrl: function() {
                let slug = this.get('slug') || '';
                if (slug.trim().length === 0) {
                    slug = "topic";
                }
                return Discourse.getURL("/t/") + slug + "/" + (this.get('id'));
            }.property('id', 'slug'),

            url: function() {
                var url = this.get('baseUrl');
                var view_only = this.get('view_only');
                return url + (view_only ? '?view_only=' + view_only : '');
            }.property('baseUrl', 'view_only'),

            urlForPostNumber(postNumber) {
                let url = this.get('baseUrl');
                if (postNumber && (postNumber > 0)) {
                    url += "/" + postNumber;
                }
                var view_only = this.get('view_only');
                return url + (view_only ? '?view_only=' + view_only : '');
            },

            summaryUrl: function () {
                var url = this.urlForPostNumber(1);
                var has_summary = this.get('has_summary');
                var view_only = this.get('view_only');
                url += has_summary || view_only ? '?' : '';
                url += has_summary ? 'filter=summary' : '';
                url += has_summary && view_only ? '&' : '';
                url += view_only ? 'view_only=' + view_only : '';
                return url;
            }.property('url')
        });

        // After "mounting"/rendering of the topic/poststream "widget"
        MountWidget.reopen({
            afterRender() {
                this._super();
                fixUrls();
            }
        });

        CategoryDrop.reopen({
            actions: {
                expand: function() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            },
        });

        DiscoveryTopics.reopen({
            actions: {
                // This schedules a rerender, so we need to also schedule
                // DOM updating
                toggleBulkSelect() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            }
        });

        // Make the navigation (latest, new, unread) buttons
        // more robust in determining if they are active since our routes/filterModes
        // will start with /forum/:project_guid
        NavigationItem.reopen({
            @computed("content.filterMode", "filterMode")
            active(contentFilterMode, filterMode) {
              return contentFilterMode === filterMode ||
                     contentFilterMode.indexOf(filterMode) !== -1;
            },
        });

        // Make the extraction of the navigation mode more robust by better checking
        // both navMode and filter in each of these functions
        DiscoveryTopicsController.reopen({
            showMoreUrl(period) {
                let url = '';
                if (this.get('model.filter').startsWith('forum')) {
                    url = '/forum/' + this.get('model.topic_list').parent_guids[0];
                }
                let category = this.get('category');
                if (category) {
                    url += '/c/' + Discourse.Category.slugFor(category) + (this.get('noSubcategories') ? '/none' : '') + '/l';
                }
                url += '/top/' + period;
                let viewOnly = this.get('view_only');
                url += viewOnly ? '?view_only=' + viewOnly : '';
                return url;
            },

            footerMessage: function() {
                if (!this.get('allLoaded')) { return; }

                const category = this.get('category');
                if (category) {
                    return I18n.t('topics.bottom.category', { category: category.get('name') });
                } else {
                    const mode = (this.get('model.navMode') || this.get('model.filter') || '').split('/').pop();
                    if (this.get('model.topics.length') === 0) {
                        return I18n.t("topics.none." + mode);
                    } else {
                        return I18n.t("topics.bottom." + mode);
                    }
                }
            }.property('allLoaded', 'model.topics.length'),

            footerEducation: function() {
                if (!this.get('allLoaded') || this.get('model.topics.length') > 0 || !Discourse.User.current()) { return; }

                const mode = (this.get('model.navMode') || this.get('model.filter') || '').split('/').pop();

                if (mode !== 'new' && mode !== 'unread') { return; }

                return I18n.t("topics.none.educate." + mode, {
                    userPrefsUrl: Discourse.getURL("/users/") + (Discourse.User.currentProp("username_lower")) + "/preferences"
                });
            }.property('allLoaded', 'model.topics.length')
        });

        // Filter some messages by the project_guid to avoid irrelevant notifications
        // Only serve latest and new_topic notifications for the correct projects
        TopicTrackingState.reopen({
            notify(data) {
                if ((data.message_type != 'latest' && data.message_type != 'new_topic') ||
                     (data.payload.project_guid && data.payload.project_guid == this.project_guid)) {
                    this._super();
                }
            },
        });

        var contributorSearch = function(term) {
            var topicModel = Discourse.__container__.lookup('controller:topic').model;
            var contributors = topicModel.contributors;
            contributors = contributors.filter(c => {
                return c.username.toLowerCase().startsWith(term.toLowerCase()) ||
                       c.name.toLowerCase().startsWith(term.toLowerCase());
            });

            var results = contributors;
            results.users = contributors.copy();
            results.groups = [];
            return results;
        };

        // Patch so that only contributors are listed for @mentions
        ComposerEditor.reopen({
            @on('didInsertElement')
            _composerEditorInit() {
                this._super();

                const template = this.container.lookup('template:user-selector-autocomplete.raw');
                const $input = this.$('.d-editor-input');
                $input.autocomplete('destroy');
                $input.autocomplete({
                    template,
                    dataSource: term => contributorSearch(term),
                    key: "@",
                    transformComplete: v => v.username || v.name
                });
            }
        });

        // keep track of the and allow access to the view_only id
        TopicController.reopen({
            queryParams: ['view_only'],
            view_only: null
        });

        // And have the parameter used in routing
        TopicRouter.reopen({
            queryParams: {
                view_only: { replace: true }
            }
        });

        TopicFromParamsRouter.reopen({
            setupController(controller, params, transition) {
                // we need to add the view_only id for it to end up in the xhr request
                if (transition.queryParams.view_only) {
                    params.view_only = transition.queryParams.view_only;
                }
                this._super(controller, params);
            }
        })
    }
};
