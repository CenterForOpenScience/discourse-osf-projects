# name: discourse-osf-integration
# about: An integration plug-in for the Open Science Framework
# version: 0.0.1
# authors: Center for Open Science
enabled_site_setting :osf_integration_enabled

require 'pry'

register_asset 'javascripts/discourse/templates/projects/index.hbs', :server_side
register_asset 'javascripts/discourse/templates/projects/show.hbs', :server_side

after_initialize do
    PROJECT_GUID_FIELD_NAME = "project_guid"
    TOPIC_GUID_FIELD_NAME = "topic_guid"

    module ::OsfIntegration
        PROJECT_GUID_FIELD_NAME = "project_guid"
        TOPIC_GUID_FIELD_NAME = "topic_guid"

        class Engine < ::Rails::Engine
            engine_name "osf_integration"
            isolate_namespace OsfIntegration
        end

        def self.clean_guid(guid)
            guid.downcase.gsub(/[^a-z0-9]/, '')
        end
    end

    # Register these custom fields so that they will allowed as parameters
    # We don't pass a block however, because we don't want to allow these guids
    # to be changed in the future.
    PostRevisor.track_topic_field(:project_guid)
    PostRevisor.track_topic_field(:topic_guid)

    # Hook onto topic creation to save our custom fields
    on(:topic_created) do |topic, params, user|
      return unless user.try(:staff?)

      project_guid = ::OsfIntegration::clean_guid(params[:project_guid])
      topic_guid = ::OsfIntegration::clean_guid(params[:topic_guid])

      topic.custom_fields.update(PROJECT_GUID_FIELD_NAME => project_guid)
      topic.custom_fields.update(TOPIC_GUID_FIELD_NAME => topic_guid)
      topic.save
    end

    # Add methods for directly extracting these fields
    add_to_class :topic, :project_guid do
      custom_fields[PROJECT_GUID_FIELD_NAME]
    end
    add_to_class :topic, :topic_guid do
      custom_fields[TOPIC_GUID_FIELD_NAME]
    end

    # override slug generation
    add_to_class :topic, :slug do
      topic_guid
    end

    # Register these custom fields to be able to appear in serializer output
    TopicViewSerializer.attributes_from_topic(:project_guid)
    TopicViewSerializer.attributes_from_topic(:topic_guid)

    # Return osf related stuff in JSON output of topic items
    add_to_serializer(:topic_list_item, :project_guid) { object.project_guid }
    add_to_serializer(:topic_list_item, :topic_guid) { object.topic_guid }

    # Mark as preloaded so that they are always available
    if TopicList.respond_to? :preloaded_custom_fields
        TopicList.preloaded_custom_fields << PROJECT_GUID_FIELD_NAME
        TopicList.preloaded_custom_fields << TOPIC_GUID_FIELD_NAME
    end

    # Routing for the project specific end-points
    ::OsfIntegration::Engine.routes.draw do
        get '/' => 'projects#index'
        constraints(project_guid: /[a-z0-9]+/) do
            get '/:project_guid' => 'projects#show'
            get '/c/:category/:project_guid' => 'projects#show'
            get '/c/:parent_category/:category/:project_guid' => 'projects#show'
            Discourse.filters.each do |filter|
              get "/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:parent_category/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
            end
        end
    end

    Discourse::Application.routes.append do
      mount ::OsfIntegration::Engine, at: "/projects"
    end

    require_dependency 'application_controller'
    require_dependency 'topic_list_responder'
    require_dependency 'topic_query'

    class ::OsfIntegration::ProjectsController < ::ApplicationController
        include ::TopicListResponder
        requires_plugin 'discourse-osf-integration'

        PAGE_SIZE = 50

        # Tries to make sure show can be called through an XHR?
        skip_before_filter :check_xhr, only: [:show]

        def index
            render json: { projects: [''] }
        end

        Discourse.filters.each do |filter|
            define_method("show_#{filter}") do
                page = params[:page].to_i

                project_guid = ::OsfIntegration::clean_guid(params[:project_guid])
                project_topics = TopicCustomField.where(name: PROJECT_GUID_FIELD_NAME, value: project_guid)
                                                 .order('topic_id DESC')
                                                 .limit(PAGE_SIZE)
                                                 .offset(PAGE_SIZE * page)
                                                 .pluck(:topic_id)

                list_options = {
                    page: 0,
                    per_page: PAGE_SIZE,
                    limit: true,
                }

                query = TopicQuery.new(current_user, list_options)

                #results = query.latest_results.where(id: project_topics)

                # Start with a list of all topics
                result = Topic.unscoped
                if current_user
                  result = result.joins("LEFT OUTER JOIN topic_users AS tu ON (topics.id = tu.topic_id AND tu.user_id = #{current_user.id.to_i})")
                                 .references('tu')
                end
                result = result.where(id: project_topics)
                list = query.create_list(nil, {}, result)
                respond_with_list(list)

                #list = query.list_private_messages(current_user)
                #respond_with_list(list)
            end
        end

        def show
          show_latest
        end
    end
end
